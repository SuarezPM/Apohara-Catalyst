/**
 * `apohara state` — single-shot JSON dump of the current run state.
 *
 * M018 Pattern F (GSD2 `gsd headless query` analogue). Reads the most
 * recent `.events/run-*.jsonl` ledger, the `.apohara/capability-stats.json`
 * provider store, and probes for sandbox + contextforge availability.
 * Never blocks on the indexer daemon and always exits 0 — it's a status
 * reporter, not a check.
 *
 * JSON shape is alpha and pinned via `schemaVersion: "v0-alpha"`.
 */

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { CapabilityStats } from "../core/capability-stats.js";
import type { EventLog, ProviderId } from "../core/types.js";

const SCHEMA_VERSION = "v0-alpha";
const CONTEXTFORGE_HEALTH_URL = "http://localhost:8001/health";
const CONTEXTFORGE_TIMEOUT_MS = 500;

type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

interface TaskState {
	id: string;
	status: TaskStatus;
	startedAt?: string;
	completedAt?: string;
}

interface ProviderEntry {
	id: ProviderId;
	trials: number;
	lastErrorClass?: string;
}

interface StateSnapshot {
	runId: string | null;
	currentTaskId: string | null;
	taskStates: TaskState[];
	providers: ProviderEntry[];
	ledgerPath: string | null;
	sandboxAvailable: boolean;
	contextforgeAvailable: boolean;
	schemaVersion: typeof SCHEMA_VERSION;
}

interface ResolveOpts {
	cwd?: string;
	eventsDir?: string;
	statsFile?: string;
	sandboxBinary?: string;
}

async function findLatestRunFile(
	eventsDir: string,
): Promise<{ path: string; runId: string } | null> {
	let entries: string[];
	try {
		entries = await readdir(eventsDir);
	} catch {
		return null;
	}
	const candidates = entries.filter(
		(n) => n.startsWith("run-") && n.endsWith(".jsonl"),
	);
	if (candidates.length === 0) return null;

	let latest: { path: string; runId: string; mtimeMs: number } | null = null;
	for (const name of candidates) {
		const full = join(eventsDir, name);
		try {
			const s = await stat(full);
			if (!latest || s.mtimeMs > latest.mtimeMs) {
				const runId = name.replace(/^run-/, "").replace(/\.jsonl$/, "");
				latest = { path: full, runId, mtimeMs: s.mtimeMs };
			}
		} catch {
			// Skip unreadable entries.
		}
	}
	if (!latest) return null;
	return { path: latest.path, runId: latest.runId };
}

async function readEvents(path: string): Promise<EventLog[]> {
	const text = await readFile(path, "utf-8");
	const out: EventLog[] = [];
	for (const line of text.split("\n")) {
		if (!line) continue;
		try {
			out.push(JSON.parse(line) as EventLog);
		} catch {
			// Skip malformed lines — the ledger may be mid-write.
		}
	}
	return out;
}

function deriveTaskStates(events: EventLog[]): {
	tasks: TaskState[];
	currentTaskId: string | null;
} {
	const map = new Map<string, TaskState>();
	for (const e of events) {
		const id = e.taskId;
		if (!id) continue;
		let state = map.get(id);
		if (!state) {
			state = { id, status: "pending" };
			map.set(id, state);
		}
		if (e.type === "task_started" || e.type === "task_dispatched") {
			state.status = "in_progress";
			if (!state.startedAt) state.startedAt = e.timestamp;
		} else if (e.type === "task_completed") {
			state.status = "completed";
			state.completedAt = e.timestamp;
		} else if (e.type === "task_failed") {
			state.status = "failed";
			state.completedAt = e.timestamp;
		}
	}
	const tasks = [...map.values()];
	const currentTaskId =
		tasks.find((t) => t.status === "in_progress")?.id ?? null;
	return { tasks, currentTaskId };
}

async function loadProviders(statsFile: string): Promise<ProviderEntry[]> {
	const stats = new CapabilityStats(statsFile);
	const all = await stats.all();
	const trialsByProvider = new Map<ProviderId, number>();
	for (const e of all) {
		const prior = trialsByProvider.get(e.provider) ?? 0;
		trialsByProvider.set(e.provider, prior + e.successes + e.failures);
	}
	return [...trialsByProvider.entries()]
		.map(([id, trials]) => ({ id, trials }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

async function probeContextforge(): Promise<boolean> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), CONTEXTFORGE_TIMEOUT_MS);
	try {
		const res = await fetch(CONTEXTFORGE_HEALTH_URL, { signal: ctrl.signal });
		return res.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

export async function collectState(
	opts: ResolveOpts = {},
): Promise<StateSnapshot> {
	const cwd = opts.cwd ?? process.cwd();
	const eventsDir = opts.eventsDir ?? join(cwd, ".events");
	const statsFile =
		opts.statsFile ?? join(cwd, ".apohara", "capability-stats.json");
	const sandboxBinary =
		opts.sandboxBinary ?? join(cwd, "target", "release", "apohara-sandbox");

	const latest = await findLatestRunFile(eventsDir);
	let events: EventLog[] = [];
	if (latest) {
		try {
			events = await readEvents(latest.path);
		} catch {
			events = [];
		}
	}
	const { tasks, currentTaskId } = deriveTaskStates(events);
	const providers = await loadProviders(statsFile);
	const sandboxAvailable = existsSync(sandboxBinary);
	const contextforgeAvailable = await probeContextforge();

	return {
		runId: latest?.runId ?? null,
		currentTaskId,
		taskStates: tasks,
		providers,
		ledgerPath: latest?.path ?? null,
		sandboxAvailable,
		contextforgeAvailable,
		schemaVersion: SCHEMA_VERSION,
	};
}

function padRight(s: string, width: number): string {
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}
function padLeft(s: string, width: number): string {
	return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function printHuman(snap: StateSnapshot): void {
	console.log("# apohara state");
	console.log(`runId:                ${snap.runId ?? "<none>"}`);
	console.log(`currentTaskId:        ${snap.currentTaskId ?? "<none>"}`);
	console.log(`ledgerPath:           ${snap.ledgerPath ?? "<none>"}`);
	console.log(`sandboxAvailable:     ${snap.sandboxAvailable}`);
	console.log(`contextforgeAvailable:${snap.contextforgeAvailable}`);
	console.log(`schemaVersion:        ${snap.schemaVersion}`);

	console.log("\n## tasks");
	if (snap.taskStates.length === 0) {
		console.log("  (none)");
	} else {
		console.log(
			padRight("id", 28) + padRight("status", 14) + padRight("started", 25),
		);
		console.log("-".repeat(67));
		for (const t of snap.taskStates) {
			console.log(
				padRight(t.id, 28) +
					padRight(t.status, 14) +
					padRight(t.startedAt ?? "-", 25),
			);
		}
	}

	console.log("\n## providers");
	if (snap.providers.length === 0) {
		console.log("  (no observations recorded yet)");
	} else {
		console.log(
			padRight("provider", 22) +
				padLeft("trials", 8) +
				"  " +
				padRight("lastErrorClass", 18),
		);
		console.log("-".repeat(50));
		for (const p of snap.providers) {
			console.log(
				padRight(p.id, 22) +
					padLeft(String(p.trials), 8) +
					"  " +
					padRight(p.lastErrorClass ?? "-", 18),
			);
		}
	}
}

export const stateCommand = new Command("state")
	.description(
		"Print a snapshot of the current Apohara run state (alpha JSON schema v0)",
	)
	.option("--json", "emit JSON instead of a human-readable summary")
	.action(async (opts: { json?: boolean }) => {
		const snap = await collectState();
		if (opts.json) {
			console.log(JSON.stringify(snap, null, 2));
		} else {
			printHuman(snap);
		}
	});
