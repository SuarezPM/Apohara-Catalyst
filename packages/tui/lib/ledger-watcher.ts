import { createReadStream, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { EventLog } from "../../../src/core/types";
import { EventParser } from "./event-parser";

export interface FileState {
	size: number;
	mtimeMs: number;
}

export interface LedgerWatcherOptions {
	eventsDir: string;
	onEvents: (filePath: string, events: EventLog[]) => void;
	onError?: (error: Error) => void;
	onFileAdded?: (filePath: string) => void;
	debug?: boolean;
	watchImpl?: typeof watch;
}

export class LedgerWatcher {
	private options: LedgerWatcherOptions;
	private fileStates = new Map<string, FileState>();
	private pendingReads = new Map<string, Promise<void>>();
	private parser = new EventParser();
	private watcher: ReturnType<typeof watch> | null = null;
	private pollInterval: ReturnType<typeof setInterval> | null = null;
	private closed = false;
	private usingPoll = false;
	private static readonly POLL_MS = 500;

	constructor(options: LedgerWatcherOptions) {
		this.options = options;
	}

	async start(): Promise<void> {
		await this.scan();

		const watcherFactory = this.options.watchImpl || watch;
		try {
			this.watcher = watcherFactory(
				this.options.eventsDir,
				(_eventType, filename) => {
					if (this.closed) return;
					if (!filename) return;
					if (!filename.endsWith(".jsonl")) return;
					const filePath = join(this.options.eventsDir, filename);
					this.read(filePath).catch((err) => this.emitError(err));
				},
			);
			this.watcher.on("error", (err) => {
				if (this.closed) return;
				this.emitError(err);
				this.switchToPolling();
			});
		} catch (err) {
			this.emitError(err as Error);
			this.switchToPolling();
		}
	}

	private switchToPolling(): void {
		if (this.usingPoll || this.closed) return;
		this.usingPoll = true;
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		if (this.options.debug) {
			console.error(
				`[LedgerWatcher] Fallback to polling for ${this.options.eventsDir}`,
			);
		}
		this.pollInterval = setInterval(() => {
			this.scan().catch((err) => this.emitError(err));
		}, LedgerWatcher.POLL_MS);
	}

	private async scan(): Promise<void> {
		let entries: string[];
		try {
			const dirents = await readdir(this.options.eventsDir, {
				withFileTypes: true,
			});
			entries = dirents
				.filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
				.map((e) => e.name);
		} catch (err) {
			this.emitError(err as Error);
			return;
		}

		for (const name of entries) {
			const filePath = join(this.options.eventsDir, name);
			const state = this.fileStates.get(filePath);
			try {
				const stats = await stat(filePath);
				if (
					!state ||
					stats.mtimeMs > state.mtimeMs ||
					stats.size > state.size
				) {
					if (!state) {
						this.options.onFileAdded?.(filePath);
					}
					await this.read(filePath);
				}
			} catch (err) {
				this.emitError(err as Error);
			}
		}

		// Detect previously tracked files that have disappeared
		for (const [filePath, _state] of this.fileStates) {
			const name = filePath.split(/[/\\]/).pop() ?? "";
			if (!entries.includes(name)) {
				this.emitError(new Error(`File removed: ${filePath}`));
				this.fileStates.delete(filePath);
			}
		}
	}

	private async read(filePath: string): Promise<void> {
		const existing = this.pendingReads.get(filePath);
		if (existing) {
			await existing;
			return;
		}
		const promise = this.readUnsafe(filePath).finally(() => {
			this.pendingReads.delete(filePath);
		});
		this.pendingReads.set(filePath, promise);
		await promise;
	}

	private async readUnsafe(filePath: string): Promise<void> {
		let stats: { size: number; mtimeMs: number };
		try {
			const s = await stat(filePath);
			stats = { size: s.size, mtimeMs: s.mtimeMs };
		} catch (err) {
			this.emitError(err as Error);
			return;
		}

		const state = this.fileStates.get(filePath);
		const start = state ? state.size : 0;

		if (stats.size < start) {
			this.fileStates.set(filePath, { size: 0, mtimeMs: stats.mtimeMs });
			await this.readUnsafe(filePath);
			return;
		}

		if (stats.size === start) {
			this.fileStates.set(filePath, stats);
			return;
		}

		const stream = createReadStream(filePath, { start, encoding: "utf-8" });
		const rl = createInterface({ input: stream, crlfDelay: Infinity });
		const lines: string[] = [];
		for await (const line of rl) {
			lines.push(line);
		}

		const events: EventLog[] = [];
		for (const line of lines) {
			const result = this.parser.parseLine(line);
			if (result.event) {
				events.push(result.event);
			}
		}

		if (events.length > 0) {
			this.options.onEvents(filePath, events);
		}
		this.fileStates.set(filePath, stats);
	}

	private emitError(error: Error): void {
		if (this.options.debug) {
			console.error(`[LedgerWatcher] ${error.message}`);
		}
		this.options.onError?.(error);
	}

	getCounters(): { malformedLines: number; unknownEventTypes: number } {
		return {
			malformedLines: this.parser.malformedLines,
			unknownEventTypes: this.parser.unknownEventTypes,
		};
	}

	close(): void {
		this.closed = true;
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}
}
