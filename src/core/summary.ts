import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EventLedger } from "./ledger";
import { StateMachine } from "./state";
import type { EventLog, OrchestratorState, Task } from "./types";

export interface SummaryOptions {
	runId?: string;
	eventsDir?: string;
	stateFilePath?: string;
	outputDir?: string;
}

export interface RunSummary {
	timestamp: string;
	duration?: number;
	tasks: TaskResult[];
	tokens?: TokenSummary;
	costUsd?: number;
	fallbacks: FallbackEvent[];
	filesCreated: string[];
	filesModified: string[];
	providers: ProviderStats[];
	runId: string;
}

export interface TaskResult {
	id: string;
	status: "completed" | "failed" | "pending" | "in_progress";
	description: string;
	durationMs?: number;
	provider?: string;
	tokens?: number;
	costUsd?: number;
}

export interface TokenSummary {
	prompt: number;
	completion: number;
	total: number;
}

export interface FallbackEvent {
	fromProvider: string;
	toProvider: string;
	timestamp: string;
	taskId?: string;
}

export interface ProviderStats {
	provider: string;
	taskCount: number;
	totalTokens: number;
	totalCostUsd: number;
}

/**
 * Summary Generator creates run narrative summaries by reading
 * from EventLedger and StateMachine, then producing a Markdown summary.
 */
export class SummaryGenerator {
	private ledger: EventLedger;
	private stateMachine: StateMachine;
	private config: {
		eventsDir: string;
		stateFilePath: string;
		outputDir: string;
	};

	constructor(options?: SummaryOptions) {
		const runId =
			options?.runId || new Date().toISOString().replace(/[:.]/g, "-");
		this.ledger = new EventLedger(runId);

		this.config = {
			eventsDir: options?.eventsDir || ".events",
			stateFilePath: options?.stateFilePath || ".apohara/state.json",
			outputDir: options?.outputDir || ".apohara/runs",
		};

		this.stateMachine = new StateMachine(this.config.stateFilePath);
	}

	/**
	 * Generates a complete run summary by reading event logs and state.
	 */
	public async generate(): Promise<string> {
		const runId =
			this.ledger
				.getFilePath()
				.split("/")
				.pop()
				?.replace("run-", "")
				?.replace(".jsonl", "") || "unknown";
		const timestamp = new Date().toISOString();

		// Load state
		const state = await this.stateMachine.load();

		// Read events from ledger
		const events = await this.readEvents();

		// Build summary data
		const tasks = this.extractTaskResults(state, events);
		const tokens = this.calculateTokens(events);
		const costUsd = this.calculateCost(events);
		const fallbacks = this.extractFallbacks(events);
		const files = this.trackFiles(events);
		const providers = this.calculateProviderStats(events);

		// Calculate total duration
		const duration = this.calculateDuration(events);

		const summary: RunSummary = {
			timestamp,
			duration,
			tasks,
			tokens,
			costUsd,
			fallbacks,
			filesCreated: files.created,
			filesModified: files.modified,
			providers,
			runId,
		};

		// Generate markdown
		const markdown = this.buildMarkdown(summary, state);

		// Write to file
		const outputPath = await this.writeSummary(markdown, runId);

		// Log the generation event
		await this.ledger.log(
			"summary_generated",
			{
				summaryPath: outputPath,
				taskCount: tasks.length,
				duration,
				costUsd,
			},
			"info",
		);

		return outputPath;
	}

	/**
	 * Reads events from the ledger file(s).
	 */
	private async readEvents(): Promise<EventLog[]> {
		const eventsDir = this.config.eventsDir;
		const events: EventLog[] = [];

		// First, try to read from the ledger's own file path
		const ledgerFilePath = this.ledger.getFilePath();
		try {
			if (existsSync(ledgerFilePath)) {
				const content = readFileSync(ledgerFilePath, "utf-8");
				const lines = content.split("\n").filter((line) => line.trim());

				for (const line of lines) {
					try {
						const event = JSON.parse(line) as EventLog;
						events.push(event);
					} catch {
						// Skip malformed lines
					}
				}
			}
		} catch {
			// Ledger file doesn't exist or isn't accessible
		}

		// Also scan the events directory for any additional files
		if (existsSync(eventsDir)) {
			try {
				const entries = readdirSync(eventsDir, { withFileTypes: true });
				const jsonlFiles = entries
					.filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
					.map((e) => join(eventsDir, e.name));

				for (const filePath of jsonlFiles) {
					// Skip the ledger file we already read
					if (filePath === ledgerFilePath) continue;

					try {
						const content = readFileSync(filePath, "utf-8");
						const lines = content.split("\n").filter((line) => line.trim());

						for (const line of lines) {
							try {
								const event = JSON.parse(line) as EventLog;
								events.push(event);
							} catch {
								// Skip malformed lines
							}
						}
					} catch {
						// Skip files that can't be read
					}
				}
			} catch {
				// Directory doesn't exist or isn't accessible
			}
		}

		// Sort by timestamp
		events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

		return events;
	}

	/**
	 * Extracts task results from state and events.
	 * Falls back to scanning events for task IDs if state has no tasks.
	 */
	private extractTaskResults(
		state: OrchestratorState,
		events: EventLog[],
	): TaskResult[] {
		const results: TaskResult[] = [];
		const seenIds = new Set<string>();

		const buildResult = (
			id: string,
			status: TaskResult["status"],
			description: string,
			taskEvents: EventLog[],
		): TaskResult => {
			const completionEvent = taskEvents.find(
				(e) => e.type === "task_completed",
			);
			const startEvent = taskEvents.find(
				(e) => e.type === "task_started" || e.type === "task_dispatched",
			);

			let durationMs: number | undefined;
			if (startEvent && completionEvent) {
				const start = new Date(startEvent.timestamp).getTime();
				const end = new Date(completionEvent.timestamp).getTime();
				durationMs = end - start;
			} else if (completionEvent?.metadata?.durationMs) {
				durationMs = completionEvent.metadata.durationMs as number;
			}

			const providerEvent = taskEvents.find((e) => e.metadata?.provider);
			const costEvent = taskEvents.find((e) => e.metadata?.costUsd);

			return {
				id,
				status,
				description,
				durationMs,
				provider: providerEvent?.metadata?.provider as string | undefined,
				costUsd: costEvent?.metadata?.costUsd as number | undefined,
			};
		};

		// Use state tasks first
		for (const task of state.tasks) {
			seenIds.add(task.id);
			const taskEvents = events.filter((e) => e.taskId === task.id);
			const completionEvent = taskEvents.find(
				(e) => e.type === "task_completed" || task.status === "completed",
			);
			results.push(
				buildResult(
					task.id,
					task.status as TaskResult["status"],
					task.description,
					taskEvents,
				),
			);
		}

		// Also scan events for task IDs not in state
		const eventTaskIds = new Set(
			events.filter((e) => e.taskId).map((e) => e.taskId as string),
		);
		for (const taskId of eventTaskIds) {
			if (seenIds.has(taskId)) continue;
			const taskEvents = events.filter((e) => e.taskId === taskId);
			const completionEvent = taskEvents.find(
				(e) => e.type === "task_completed",
			);
			const status: TaskResult["status"] = completionEvent
				? "completed"
				: "in_progress";
			results.push(buildResult(taskId, status, taskId, taskEvents));
		}

		return results;
	}

	/**
	 * Calculates total tokens from events.
	 */
	private calculateTokens(events: EventLog[]): TokenSummary | undefined {
		let prompt = 0;
		let completion = 0;

		for (const event of events) {
			const tokens = event.metadata?.tokens;
			if (tokens) {
				prompt += tokens.prompt || 0;
				completion += tokens.completion || 0;
			}
		}

		const total = prompt + completion;
		if (total === 0) return undefined;

		return { prompt, completion, total };
	}

	/**
	 * Calculates total cost from events.
	 */
	private calculateCost(events: EventLog[]): number | undefined {
		let total = 0;

		for (const event of events) {
			const cost = event.metadata?.costUsd;
			if (typeof cost === "number") {
				total += cost;
			}
		}

		return total > 0 ? total : undefined;
	}

	/**
	 * Extracts fallback events from the ledger.
	 */
	private extractFallbacks(events: EventLog[]): FallbackEvent[] {
		const fallbacks: FallbackEvent[] = [];

		for (const event of events) {
			if (event.type === "provider_fallback" || event.type === "fallback") {
				fallbacks.push({
					fromProvider:
						(event.payload.from as string) ||
						(event.payload.provider as string) ||
						"unknown",
					toProvider:
						(event.payload.to as string) ||
						(event.payload.fallback as string) ||
						"unknown",
					timestamp: event.timestamp,
					taskId: event.taskId,
				});
			}
		}

		return fallbacks;
	}

	/**
	 * Tracks files created and modified from events.
	 */
	private trackFiles(events: EventLog[]): {
		created: string[];
		modified: string[];
	} {
		const created: string[] = [];
		const modified: string[] = [];

		for (const event of events) {
			if (event.type === "file_created") {
				const file = event.payload.file as string;
				if (file && !created.includes(file)) {
					created.push(file);
				}
			}
			if (event.type === "file_modified") {
				const file = event.payload.file as string;
				if (file && !modified.includes(file) && !created.includes(file)) {
					modified.push(file);
				}
			}
		}

		return { created, modified };
	}

	/**
	 * Calculates provider statistics from events.
	 */
	private calculateProviderStats(events: EventLog[]): ProviderStats[] {
		const statsMap = new Map<string, ProviderStats>();

		for (const event of events) {
			const provider = event.metadata?.provider as string | undefined;
			if (!provider) continue;

			const existing = statsMap.get(provider) || {
				provider,
				taskCount: 0,
				totalTokens: 0,
				totalCostUsd: 0,
			};

			existing.taskCount += 1;
			existing.totalTokens += event.metadata?.tokens?.total || 0;
			existing.totalCostUsd += (event.metadata?.costUsd as number) || 0;

			statsMap.set(provider, existing);
		}

		return Array.from(statsMap.values());
	}

	/**
	 * Calculates total run duration from first to last event.
	 */
	private calculateDuration(events: EventLog[]): number | undefined {
		if (events.length === 0) return undefined;

		const first = events[0].timestamp;
		const last = events[events.length - 1].timestamp;

		const start = new Date(first).getTime();
		const end = new Date(last).getTime();

		return end - start;
	}

	/**
	 * Builds markdown summary from run data.
	 */
	private buildMarkdown(summary: RunSummary, state: OrchestratorState): string {
		const lines: string[] = [];

		// Header
		const date = new Date(summary.timestamp).toISOString();
		lines.push(`# Apohara Auto Run Summary`);
		lines.push(``);
		lines.push(`**Run ID:** ${summary.runId}`);
		lines.push(`**Timestamp:** ${date}`);
		if (summary.duration) {
			lines.push(`**Duration:** ${this.formatDuration(summary.duration)}`);
		}
		lines.push(`**Status:** ${this.getOverallStatus(summary.tasks)}`);
		lines.push(``);

		// Tasks section
		lines.push(`---`);
		lines.push(``);
		lines.push(`## Tasks Executed`);
		lines.push(``);

		if (summary.tasks.length === 0) {
			lines.push(`No tasks recorded in this run.`);
		} else {
			lines.push(`| Task ID | Status | Duration | Provider | Cost |`);
			lines.push(`|---------|--------|----------|----------|------|`);
			for (const task of summary.tasks) {
				const status =
					task.status === "completed"
						? "✅"
						: task.status === "failed"
							? "❌"
							: "⏳";
				const duration = task.durationMs
					? this.formatDuration(task.durationMs)
					: "N/A";
				const provider = task.provider || "N/A";
				const cost = task.costUsd ? `$${task.costUsd.toFixed(4)}` : "N/A";
				lines.push(
					`| ${task.id} | ${status} ${task.status} | ${duration} | ${provider} | ${cost} |`,
				);
			}
		}
		lines.push(``);

		// Tokens and Cost section
		if (summary.tokens || summary.costUsd) {
			lines.push(`---`);
			lines.push(``);
			lines.push(`## Usage Summary`);
			lines.push(``);
			if (summary.tokens) {
				lines.push(
					`- **Prompt Tokens:** ${summary.tokens.prompt.toLocaleString()}`,
				);
				lines.push(
					`- **Completion Tokens:** ${summary.tokens.completion.toLocaleString()}`,
				);
				lines.push(
					`- **Total Tokens:** ${summary.tokens.total.toLocaleString()}`,
				);
			}
			if (summary.costUsd) {
				lines.push(`- **Estimated Cost:** $${summary.costUsd.toFixed(4)}`);
			}
			lines.push(``);
		}

		// Fallbacks section
		if (summary.fallbacks.length > 0) {
			lines.push(`---`);
			lines.push(``);
			lines.push(`## Fallbacks Activated`);
			lines.push(``);
			for (const fb of summary.fallbacks) {
				lines.push(
					`- ${fb.timestamp}: ${fb.fromProvider} → ${fb.toProvider}${fb.taskId ? ` (task: ${fb.taskId})` : ""}`,
				);
			}
			lines.push(``);
		}

		// Files section
		if (summary.filesCreated.length > 0 || summary.filesModified.length > 0) {
			lines.push(`---`);
			lines.push(``);
			lines.push(`## Files`);
			lines.push(``);
			if (summary.filesCreated.length > 0) {
				lines.push(`### Created`);
				lines.push(``);
				for (const file of summary.filesCreated) {
					lines.push(`- ${file}`);
				}
				lines.push(``);
			}
			if (summary.filesModified.length > 0) {
				lines.push(`### Modified`);
				lines.push(``);
				for (const file of summary.filesModified) {
					lines.push(`- ${file}`);
				}
				lines.push(``);
			}
		}

		// Provider stats section
		if (summary.providers.length > 0) {
			lines.push(`---`);
			lines.push(``);
			lines.push(`## Provider Statistics`);
			lines.push(``);
			lines.push(`| Provider | Tasks | Tokens | Cost |`);
			lines.push(`|----------|-------|--------|------|`);
			for (const stat of summary.providers) {
				lines.push(
					`| ${stat.provider} | ${stat.taskCount} | ${stat.totalTokens.toLocaleString()} | $${stat.totalCostUsd.toFixed(4)} |`,
				);
			}
			lines.push(``);
		}

		// Narrative conclusion
		lines.push(`---`);
		lines.push(``);
		lines.push(this.generateNarrative(summary));

		return lines.join("\n");
	}

	/**
	 * Generates a narrative conclusion for the summary.
	 */
	private generateNarrative(summary: RunSummary): string {
		const completed = summary.tasks.filter(
			(t) => t.status === "completed",
		).length;
		const failed = summary.tasks.filter((t) => t.status === "failed").length;
		const total = summary.tasks.length;
		const fallbackCount = summary.fallbacks.length;

		let narrative = `## Narrative\n\n`;

		if (total === 0) {
			narrative += `This run completed without any tasks being executed. The system may have been idle or the task queue was empty.\n`;
		} else if (failed === 0 && completed === total) {
			narrative += `This run completed successfully. All ${total} task(s) finished without errors.`;
			if (fallbackCount > 0) {
				narrative += ` There were ${fallbackCount} provider fallback(s) during execution, but all tasks completed successfully despite the provider switches.`;
			}
		} else if (completed > 0 && failed > 0) {
			narrative += `This run completed with partial success. ${completed} of ${total} task(s) completed successfully, while ${failed} task(s) failed.`;
			if (fallbackCount > 0) {
				narrative += ` ${fallbackCount} provider fallback(s) occurred during this run.`;
			}
		} else if (failed > 0) {
			narrative += `This run encountered issues. All ${total} task(s) failed to complete successfully.`;
		} else {
			narrative += `This run is in progress or the status is unknown.`;
		}

		if (summary.costUsd) {
			narrative += ` The estimated cost for this run was $${summary.costUsd.toFixed(4)}.`;
		}

		narrative += `\n`;

		return narrative;
	}

	/**
	 * Formats duration in a human-readable way.
	 */
	private formatDuration(ms: number): string {
		if (ms < 1000) {
			return `${ms}ms`;
		}
		if (ms < 60000) {
			return `${(ms / 1000).toFixed(1)}s`;
		}
		const minutes = Math.floor(ms / 60000);
		const seconds = ((ms % 60000) / 1000).toFixed(0);
		return `${minutes}m ${seconds}s`;
	}

	/**
	 * Determines overall status from task results.
	 */
	private getOverallStatus(tasks: TaskResult[]): string {
		if (tasks.length === 0) return "⚪ No tasks";
		const completed = tasks.filter((t) => t.status === "completed").length;
		const failed = tasks.filter((t) => t.status === "failed").length;

		if (failed === 0 && completed === tasks.length) {
			return "✅ All tasks completed";
		}
		if (completed > 0 && failed > 0) {
			return "⚠️ Partial success";
		}
		if (failed > 0) {
			return "❌ All tasks failed";
		}
		return "⏳ In progress or unknown";
	}

	/**
	 * Writes the summary markdown to a file.
	 */
	private async writeSummary(content: string, runId: string): Promise<string> {
		const outputDir = join(this.config.outputDir, runId);
		await mkdir(outputDir, { recursive: true });

		const outputPath = join(outputDir, "summary.md");
		await writeFile(outputPath, content, "utf-8");

		return outputPath;
	}

	/**
	 * Gets the ledger instance for external logging.
	 */
	public getLedger(): EventLedger {
		return this.ledger;
	}

	/**
	 * Gets the state machine instance.
	 */
	public getStateMachine(): StateMachine {
		return this.stateMachine;
	}
}

/**
 * Entry point for CLI execution.
 */
export async function main(): Promise<string> {
	const generator = new SummaryGenerator();
	const outputPath = await generator.generate();

	console.log(`\n📊 Summary generated: ${outputPath}`);

	return outputPath;
}
