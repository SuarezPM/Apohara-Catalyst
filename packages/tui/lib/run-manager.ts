import type { EventLog } from "../../../src/core/types";
import type { DebugCounters, Run } from "../types";
import { LedgerWatcher } from "./ledger-watcher";

export interface RunManagerOptions {
	eventsDir: string;
	onRunsChanged?: (runs: Run[]) => void;
	onCountersChanged?: (counters: DebugCounters) => void;
	onError?: (error: Error) => void;
	debug?: boolean;
	watchImpl?: ConstructorParameters<typeof LedgerWatcher>[0]["watchImpl"];
}

function runIdFromPath(filePath: string): string {
	const base = filePath.split(/[/\\]/).pop() ?? filePath;
	return base.replace(/\.jsonl$/, "");
}

export class RunManager {
	private watcher: LedgerWatcher;
	private runs = new Map<string, Run>();
	private options: RunManagerOptions;
	private lastCounters: DebugCounters = {
		malformedLines: 0,
		unknownEventTypes: 0,
	};

	constructor(options: RunManagerOptions) {
		this.options = options;
		this.watcher = new LedgerWatcher({
			eventsDir: options.eventsDir,
			onEvents: (filePath, events) => this.handleEvents(filePath, events),
			onError: (error) => this.handleError(error),
			onFileAdded: (filePath) => this.handleFileAdded(filePath),
			debug: options.debug,
			watchImpl: options.watchImpl,
		});
	}

	async start(): Promise<void> {
		await this.watcher.start();
	}

	close(): void {
		this.watcher.close();
	}

	getRuns(): Run[] {
		return Array.from(this.runs.values()).sort(
			(a, b) =>
				new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
		);
	}

	getRunById(id: string): Run | undefined {
		return this.runs.get(id);
	}

	getCounters(): DebugCounters {
		return this.watcher.getCounters();
	}

	private handleFileAdded(filePath: string): void {
		const runId = runIdFromPath(filePath);
		if (!this.runs.has(runId)) {
			const run: Run = {
				id: runId,
				startedAt: new Date().toISOString(),
				events: [],
			};
			this.runs.set(runId, run);
			this.emitRuns();
		}
	}

	private handleEvents(filePath: string, events: EventLog[]): void {
		const runId = runIdFromPath(filePath);
		let run = this.runs.get(runId);
		if (!run) {
			run = {
				id: runId,
				startedAt: events[0]?.timestamp ?? new Date().toISOString(),
				events: [],
			};
			this.runs.set(runId, run);
		}

		// Update startedAt from first event if still default
		if (events.length > 0 && run.events.length === 0) {
			run.startedAt = events[0].timestamp;
		}

		run.events.push(...events);

		// Update endedAt if any terminal event appears
		const terminalTypes = new Set([
			"auto_command_completed",
			"auto_command_failed",
			"task_exhausted",
		]);
		for (const event of events) {
			if (terminalTypes.has(event.type)) {
				run.endedAt = event.timestamp;
			}
		}
		// If no explicit terminal event, endedAt follows last event
		if (!run.endedAt && events.length > 0) {
			run.endedAt = events[events.length - 1].timestamp;
		}

		this.emitRuns();
		this.emitCountersIfChanged();
	}

	private handleError(error: Error): void {
		if (this.options.debug) {
			console.error(`[RunManager] ${error.message}`);
		}
		this.options.onError?.(error);
	}

	private emitRuns(): void {
		try {
			this.options.onRunsChanged?.(this.getRuns());
		} catch (err) {
			this.handleError(err as Error);
		}
	}

	private emitCountersIfChanged(): void {
		const counters = this.watcher.getCounters();
		if (
			counters.malformedLines !== this.lastCounters.malformedLines ||
			counters.unknownEventTypes !== this.lastCounters.unknownEventTypes
		) {
			this.lastCounters = { ...counters };
			try {
				this.options.onCountersChanged?.(counters);
			} catch (err) {
				this.handleError(err as Error);
			}
		}
	}
}
