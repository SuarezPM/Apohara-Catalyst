import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EventLog, EventSeverity, ProviderId, TaskRole } from "./types";

export const LEDGER_VERSION = 1;
export const GENESIS_PREV_HASH = "0".repeat(64);

/**
 * Canonical event type written by the agent router on every completed
 * (or failed) provider call. Consumed by M013.3 capability-stats
 * collection and surfaced in `apohara stats`.
 */
export const PROVIDER_OUTCOME_EVENT = "provider_outcome";

type UnsealedEvent = Omit<EventLog, "prev_hash" | "hash">;

export type VerifyResult =
	| { ok: true; legacy: boolean; events: number }
	| { ok: false; brokenAt: number; reason: string };

function canonicalize(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		// JSON.stringify converts undefined array elements to null
		return `[${value.map((v) => (v === undefined ? "null" : canonicalize(v))).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	// Match JSON.stringify: drop keys whose value is undefined
	const keys = Object.keys(obj)
		.filter((k) => obj[k] !== undefined)
		.sort();
	const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
	return `{${parts.join(",")}}`;
}

function hashEvent(prevHash: string, event: UnsealedEvent): string {
	return createHash("sha256")
		.update(prevHash)
		.update(canonicalize(event))
		.digest("hex");
}

export class EventLedger {
	private filePath: string;
	private runId: string;
	private initPromise: Promise<void> | null = null;
	private writeQueue: Promise<void> = Promise.resolve();
	private lastHash: string = GENESIS_PREV_HASH;

	constructor(runId?: string, options?: { filePath?: string }) {
		this.runId = runId || new Date().toISOString().replace(/[:.]/g, "-");
		this.filePath =
			options?.filePath ??
			join(process.cwd(), ".events", `run-${this.runId}.jsonl`);
	}

	private init(): Promise<void> {
		if (!this.initPromise) {
			this.initPromise = (async () => {
				await mkdir(dirname(this.filePath), { recursive: true });
				let size = 0;
				try {
					size = (await stat(this.filePath)).size;
				} catch {
					// file doesn't exist yet
				}
				if (size === 0) {
					await this.writeGenesis();
				} else {
					await this.loadLastHash();
				}
			})();
		}
		return this.initPromise;
	}

	private async writeGenesis(): Promise<void> {
		const event: UnsealedEvent = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			type: "genesis",
			severity: "info",
			payload: {
				runId: this.runId,
				ledgerVersion: LEDGER_VERSION,
			},
		};
		const hash = hashEvent(GENESIS_PREV_HASH, event);
		const sealed: EventLog = { ...event, prev_hash: GENESIS_PREV_HASH, hash };
		await appendFile(this.filePath, `${JSON.stringify(sealed)}\n`, "utf-8");
		this.lastHash = hash;
	}

	private async loadLastHash(): Promise<void> {
		// Existing file (e.g., restart mid-run): pick up the last hash so future events chain.
		// Legacy files without hashes leave lastHash at GENESIS_PREV_HASH; new events form a
		// fresh sub-chain. verify() rejects mixed legacy/hashed files.
		const content = await readFile(this.filePath, "utf-8");
		const lines = content.split("\n").filter((l) => l.length > 0);
		if (lines.length === 0) return;
		try {
			const parsed = JSON.parse(lines[lines.length - 1]) as EventLog;
			if (parsed.hash) this.lastHash = parsed.hash;
		} catch {
			// partial last line — ignore
		}
	}

	public async log(
		type: string,
		payload: Record<string, unknown>,
		severity: EventSeverity = "info",
		taskId?: string,
		metadata?: EventLog["metadata"],
	): Promise<void> {
		// Serialize writes so hash chain is consistent under concurrent log() calls.
		this.writeQueue = this.writeQueue.then(async () => {
			await this.init();
			const event: UnsealedEvent = {
				id: randomUUID(),
				timestamp: new Date().toISOString(),
				type,
				severity,
				taskId,
				payload,
				metadata,
			};
			const hash = hashEvent(this.lastHash, event);
			const sealed: EventLog = { ...event, prev_hash: this.lastHash, hash };
			await appendFile(this.filePath, `${JSON.stringify(sealed)}\n`, "utf-8");
			this.lastHash = hash;
		});
		return this.writeQueue;
	}

	public getFilePath(): string {
		return this.filePath;
	}

	/**
	 * Emit a `provider_outcome` event. This is the canonical signal the
	 * Thompson-Sampling ranker consumes: every routed call ends with one
	 * success=true or success=false entry. The hash chain is unchanged —
	 * this is just `log(PROVIDER_OUTCOME_EVENT, …)` with a typed shape.
	 */
	public async logProviderOutcome(
		provider: ProviderId,
		role: TaskRole,
		success: boolean,
		options: {
			taskId?: string;
			errorReason?: string;
			explored?: boolean;
		} = {},
	): Promise<void> {
		await this.log(
			PROVIDER_OUTCOME_EVENT,
			{
				message: `Provider ${provider} ${success ? "succeeded" : "failed"} on role ${role}`,
				provider,
				role,
				success,
				errorReason: options.errorReason,
				explored: options.explored,
			},
			success ? "info" : "warning",
			options.taskId,
			{
				role,
				provider,
				errorReason: options.errorReason,
			},
		);
	}

	public static async verify(filePath: string): Promise<VerifyResult> {
		let content: string;
		try {
			content = await readFile(filePath, "utf-8");
		} catch (e) {
			return {
				ok: false,
				brokenAt: -1,
				reason: `Cannot read file: ${(e as Error).message}`,
			};
		}
		const lines = content.split("\n").filter((l) => l.length > 0);
		if (lines.length === 0) return { ok: true, legacy: false, events: 0 };

		let prevHash = GENESIS_PREV_HASH;
		let sawHashed = false;
		let sawLegacy = false;

		for (let i = 0; i < lines.length; i++) {
			let parsed: EventLog;
			try {
				parsed = JSON.parse(lines[i]) as EventLog;
			} catch (e) {
				return {
					ok: false,
					brokenAt: i,
					reason: `Invalid JSON: ${(e as Error).message}`,
				};
			}
			if (parsed.hash === undefined && parsed.prev_hash === undefined) {
				sawLegacy = true;
				continue;
			}
			if (parsed.hash === undefined || parsed.prev_hash === undefined) {
				return {
					ok: false,
					brokenAt: i,
					reason: "Missing prev_hash or hash on hashed event",
				};
			}
			sawHashed = true;
			if (parsed.prev_hash !== prevHash) {
				return {
					ok: false,
					brokenAt: i,
					reason: `prev_hash mismatch (expected ${prevHash}, got ${parsed.prev_hash})`,
				};
			}
			const { prev_hash, hash, ...rest } = parsed;
			const expected = hashEvent(prev_hash, rest);
			if (expected !== hash) {
				return {
					ok: false,
					brokenAt: i,
					reason: `hash mismatch (expected ${expected}, got ${hash})`,
				};
			}
			prevHash = hash;
		}

		if (sawLegacy && sawHashed) {
			return {
				ok: false,
				brokenAt: -1,
				reason: "Mixed legacy + hashed events",
			};
		}

		return { ok: true, legacy: sawLegacy && !sawHashed, events: lines.length };
	}
}
