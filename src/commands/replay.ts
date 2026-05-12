import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { EventLedger } from "../core/ledger";
import type { EventLog, ProviderId } from "../core/types";
import { type LLMMessage, ProviderRouter } from "../providers/router";

export interface LLMRequestEvent {
	provider: ProviderId;
	model: string | null;
	messages: LLMMessage[];
}

export interface ReplayPlan {
	runId: string;
	filePath: string;
	totalEvents: number;
	llmRequests: LLMRequestEvent[];
	ledgerVersion: number | null;
}

export function resolveRunPath(runId: string): string {
	// Accept either bare runId ("2026-05-11T22-30-47-262Z") or path-like input.
	if (runId.includes("/") || runId.endsWith(".jsonl")) return runId;
	return join(process.cwd(), ".events", `run-${runId}.jsonl`);
}

export async function buildPlan(filePath: string): Promise<ReplayPlan> {
	const content = await readFile(filePath, "utf-8");
	const lines = content.split("\n").filter((l) => l.length > 0);

	let ledgerVersion: number | null = null;
	let runId = "";
	const llmRequests: LLMRequestEvent[] = [];

	for (const line of lines) {
		const event = JSON.parse(line) as EventLog;
		if (event.type === "genesis") {
			const p = event.payload as { runId?: string; ledgerVersion?: number };
			runId = p.runId ?? runId;
			ledgerVersion = p.ledgerVersion ?? null;
			continue;
		}
		if (event.type === "llm_request") {
			const p = event.payload as unknown as LLMRequestEvent;
			llmRequests.push({
				provider: p.provider,
				model: p.model,
				messages: p.messages,
			});
		}
	}

	return {
		runId,
		filePath,
		totalEvents: lines.length,
		llmRequests,
		ledgerVersion,
	};
}

export function planToDeterministicJSON(plan: ReplayPlan): string {
	// Stable ordering: sort top-level keys, keep llmRequests order (replay is sequential).
	const ordered = {
		filePath: plan.filePath,
		ledgerVersion: plan.ledgerVersion,
		llmRequests: plan.llmRequests.map((r) => ({
			messages: r.messages.map((m) => ({ content: m.content, role: m.role })),
			model: r.model,
			provider: r.provider,
		})),
		runId: plan.runId,
		totalEvents: plan.totalEvents,
	};
	return JSON.stringify(ordered, null, 2);
}

export const replayCommand = new Command("replay")
	.description(
		"Replay an event ledger with deterministic LLM calls (temperature:0)",
	)
	.argument("<run-id>", "Run ID or path to .events/run-<id>.jsonl")
	.option("--dry-run", "Print the call plan as JSON without executing", false)
	.option("--skip-verify", "Skip hash chain verification (dangerous)", false)
	.action(
		async (
			runId: string,
			options: { dryRun: boolean; skipVerify: boolean },
		) => {
			const filePath = resolveRunPath(runId);

			if (!options.skipVerify) {
				const result = await EventLedger.verify(filePath);
				if (!result.ok) {
					console.error(
						`Ledger verification failed at line ${result.brokenAt}: ${result.reason}`,
					);
					process.exit(1);
				}
				if (result.legacy) {
					console.error(
						`Cannot replay legacy ledger (no hash chain). Re-run with hashed ledger or use --skip-verify.`,
					);
					process.exit(1);
				}
			}

			const plan = await buildPlan(filePath);

			if (options.dryRun) {
				console.log(planToDeterministicJSON(plan));
				return;
			}

			if (plan.llmRequests.length === 0) {
				console.error(
					"No llm_request events found in ledger. Nothing to replay.",
				);
				process.exit(1);
			}

			const router = new ProviderRouter({ replayMode: true });
			console.log(
				`Replaying ${plan.llmRequests.length} request(s) from ${plan.runId} (temperature:0)`,
			);
			let succeeded = 0;
			for (let i = 0; i < plan.llmRequests.length; i++) {
				const req = plan.llmRequests[i];
				try {
					// Bypass the router's fallback selection — replay must use the recorded provider.
					const response = await router.completion({
						messages: req.messages,
						provider: req.provider,
					});
					console.log(
						`  [${i + 1}/${plan.llmRequests.length}] ${req.provider} ${response.model} ok (${response.usage.totalTokens} tok)`,
					);
					succeeded++;
				} catch (e) {
					console.error(
						`  [${i + 1}/${plan.llmRequests.length}] ${req.provider} failed: ${(e as Error).message}`,
					);
				}
			}
			console.log(
				`Replay done: ${succeeded}/${plan.llmRequests.length} succeeded`,
			);
			if (succeeded < plan.llmRequests.length) process.exit(2);
		},
	);
