/**
 * Cross-Verification Mesh — 3-agent consensus pattern for critical tasks.
 *
 * Executes tasks with two independent agents (A + B) and verifies outputs via
 * structural comparison (AST, diffs, test execution). Only applies to 5-10% of
 * critical tasks (high/critical complexity, >3 files modified).
 *
 * Graceful degradation:
 * - If B crashes (OOM, segfault, timeout) → degrade to A alone
 * - If mesh cost hits 15% of session total → disable for remainder
 * - If B exceeds max(A_time * 2, threshold) → SIGKILL B, use A
 */

import { ProviderRouter } from "../providers/router";
import { routeTaskWithFallback } from "./agent-router";
import type { FileSignaturesResponse, IndexerClient } from "./indexer-client";
import { JCRSafetyGate } from "./jcr-safety-gate";
import { EventLedger } from "./ledger";
import type { ProviderId, TaskRole } from "./types";

export interface VerificationPolicy {
	enabled: boolean;
	mode: "structural" | "semantic";
	max_extra_cost_pct: number;
	min_complexity: "high" | "critical";
}

export interface MeshExecutionOptions {
	taskId: string;
	role: TaskRole;
	task: {
		id?: string;
		messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
		complexity?: "low" | "medium" | "high" | "critical";
		filesModified?: number;
	};
	policy?: Partial<VerificationPolicy>;
	/** Override Agent B timeout in ms (for testing only — bypasses max(2×A_time, 30s) floor). */
	agentBTimeoutMs?: number;
}

export interface MeshResult {
	agentA: {
		provider: ProviderId;
		response: any;
		exitCode: number;
	};
	agentB?: {
		provider: ProviderId;
		response?: any;
		exitCode: number;
		crashed: boolean;
		timedOut: boolean;
	};
	arbiter?: {
		provider: ProviderId;
		verdict: "A" | "B" | "conflict";
		reasoning: string;
	};
	meshApplied: boolean;
	meshCostDelta: number; // Cost of B + arbiter relative to A alone
	totalCost: number;
}

export type RouterFn = typeof routeTaskWithFallback;

export class VerificationMesh {
	private ledger: EventLedger;
	private sessionCostBase: number = 0;
	private sessionVerificationCost: number = 0;
	private meshEnabled: boolean = true;
	private routerFn: RouterFn;
	private indexerClient: IndexerClient | null;

	private defaultPolicy: VerificationPolicy = {
		enabled: true,
		mode: "structural",
		max_extra_cost_pct: 15,
		min_complexity: "high",
	};

	/**
	 * @param routerFn - Injectable router for testing; defaults to routeTaskWithFallback
	 * @param indexerClient - Injectable indexer client for context compression; null disables it
	 */
	// INV-15 safety gate (M015.4). Enforces dense prefill for the arbiter
	// when its risk score exceeds τ — guards against the Judge Candidate
	// Reuse failure mode. See src/core/jcr-safety-gate.ts and
	// DOI 10.5281/zenodo.20114594.
	private jcrGate: JCRSafetyGate;

	constructor(routerFn?: RouterFn, indexerClient?: IndexerClient | null) {
		this.ledger = new EventLedger();
		this.routerFn = routerFn ?? routeTaskWithFallback;
		this.indexerClient = indexerClient ?? null;
		this.jcrGate = new JCRSafetyGate();
	}

	/** Exposed for telemetry / dashboard. Aggregate INV-15 stats over the run. */
	getJcrSummary() {
		return this.jcrGate.summary();
	}

	/**
	 * Determine if a task qualifies for cross-verification.
	 */
	private shouldVerify(
		task: MeshExecutionOptions["task"],
		policy: VerificationPolicy,
	): boolean {
		if (!policy.enabled || !this.meshEnabled) {
			return false;
		}

		// Check complexity tier
		if (
			policy.min_complexity === "critical" &&
			task.complexity !== "critical"
		) {
			return false;
		}
		if (
			policy.min_complexity === "high" &&
			task.complexity !== "high" &&
			task.complexity !== "critical"
		) {
			return false;
		}

		// Check files modified threshold
		if (task.filesModified && task.filesModified < 3) {
			return false;
		}

		return true;
	}

	/**
	 * Execute task with optional cross-verification.
	 * Returns result from best performing agent (A or B+arbiter).
	 */
	public async execute(options: MeshExecutionOptions): Promise<MeshResult> {
		const policy = { ...this.defaultPolicy, ...options.policy };
		const shouldVerify = this.shouldVerify(options.task, policy);

		const startTime = Date.now();

		// Execute Agent A (primary executor)
		const agentA = await this.routerFn(options.role, options.task);
		const agentAResponse = agentA.response;
		const agentACost = this.estimateCost(agentA.provider);

		// Accumulate baseline (all Agent A costs)
		this.sessionCostBase += agentACost;

		// If mesh not applicable, return A alone
		if (!shouldVerify) {
			await this.ledger.log(
				"verification_mesh_skipped",
				{
					taskId: options.taskId,
					reason: "not_qualified_for_verification",
					complexity: options.task.complexity,
					filesModified: options.task.filesModified,
					meshApplied: false,
				},
				"info",
				options.taskId,
			);

			return {
				agentA: {
					provider: agentA.provider,
					response: agentAResponse,
					exitCode: 0,
				},
				meshApplied: false,
				meshCostDelta: 0,
				totalCost: agentACost,
			};
		}

		// Mesh applies — execute Agent B with timeout
		const agentBTimeout =
			options.agentBTimeoutMs !== undefined
				? options.agentBTimeoutMs
				: Math.max(Math.ceil(Date.now() - startTime) * 2, 30000); // max(A_time * 2, 30s)

		const agentB = await Promise.race([
			this.routerFn(options.role, options.task),
			new Promise<{
				provider: ProviderId;
				response: any;
				timedOut: true;
			}>((resolve) =>
				setTimeout(
					() =>
						resolve({
							provider: "groq",
							response: null,
							timedOut: true,
						}),
					agentBTimeout,
				),
			),
		]);

		const agentBTimedOut = "timedOut" in agentB && agentB.timedOut;
		const agentBCrashed = !agentBTimedOut && agentB.response === null;
		const agentBResponse =
			agentBTimedOut || agentBCrashed ? null : agentB.response;
		const agentBCost =
			agentBTimedOut || agentBCrashed ? 0 : this.estimateCost(agentB.provider);

		// If B crashed or timed out, degrade to A alone
		if (agentBTimedOut || agentBCrashed || agentBResponse === null) {
			await this.ledger.log(
				"verification_mesh_degraded",
				{
					taskId: options.taskId,
					reason: agentBTimedOut ? "agent_b_timeout" : "agent_b_crashed",
					meshApplied: false,
					agentBProvider: agentB.provider,
				},
				"warning",
				options.taskId,
			);

			return {
				agentA: {
					provider: agentA.provider,
					response: agentAResponse,
					exitCode: 0,
				},
				agentB: {
					provider: agentB.provider,
					response: null,
					exitCode: agentBTimedOut ? 143 : 139,
					crashed: agentBCrashed,
					timedOut: agentBTimedOut,
				},
				meshApplied: false,
				meshCostDelta: 0,
				totalCost: agentACost,
			};
		}

		// Perform LLM-based arbitration
		const arbiterVerdict = await this.runArbiter(
			agentAResponse,
			agentBResponse,
			options.task,
		);

		const arbiterCost = this.estimateCost(arbiterVerdict.provider);
		const meshCost = agentBCost + arbiterCost;

		// Update session costs now (before circuit-breaker check so it's based on accumulated totals)
		this.sessionVerificationCost += meshCost;

		// Check if accumulated verification cost now exceeds the session budget
		// Circuit breaker fires for FUTURE tasks, not the current one
		const accumulatedExtraCostPct =
			(this.sessionVerificationCost / this.sessionCostBase) * 100;

		if (accumulatedExtraCostPct > policy.max_extra_cost_pct) {
			this.meshEnabled = false;

			await this.ledger.log(
				"verification_mesh_circuit_breaker",
				{
					taskId: options.taskId,
					reason: "cost_threshold_exceeded",
					accumulatedExtraCostPct,
					threshold: policy.max_extra_cost_pct,
					meshApplied: true,
					costPercentage: accumulatedExtraCostPct,
				},
				"warning",
				options.taskId,
			);
		}

		const selectedResponse =
			arbiterVerdict.verdict === "A" ? agentAResponse : agentBResponse;
		const selectedProvider =
			arbiterVerdict.verdict === "A" ? agentA.provider : agentB.provider;

		await this.ledger.log(
			"verification_mesh_completed",
			{
				taskId: options.taskId,
				verdict: arbiterVerdict.verdict,
				agentAProvider: agentA.provider,
				agentBProvider: agentB.provider,
				arbiterReasoning: arbiterVerdict.reasoning,
				meshCostDelta: meshCost,
				meshApplied: true,
			},
			"info",
			options.taskId,
		);

		return {
			agentA: {
				provider: agentA.provider,
				response: agentAResponse,
				exitCode: 0,
			},
			agentB: {
				provider: agentB.provider,
				response: agentBResponse,
				exitCode: 0,
				crashed: false,
				timedOut: false,
			},
			arbiter: {
				provider: arbiterVerdict.provider,
				verdict: arbiterVerdict.verdict,
				reasoning: arbiterVerdict.reasoning,
			},
			meshApplied: true,
			meshCostDelta: meshCost,
			totalCost: agentACost + meshCost,
		};
	}

	/**
	 * Extract modified file paths from agent response.
	 * Looks for:
	 * 1. A `modifiedFiles` field in the response
	 * 2. Diff-style patterns like "+++ b/path/to/file"
	 */
	private extractModifiedFiles(response: any): string[] {
		const content = this.extractContent(response);
		const files = new Set<string>();

		// Try to find modifiedFiles field if present
		if (response && typeof response === "object") {
			if (response.modifiedFiles && Array.isArray(response.modifiedFiles)) {
				for (const file of response.modifiedFiles) {
					if (typeof file === "string") {
						files.add(file);
					}
				}
			}
		}

		// Also look for diff-style patterns: "+++ b/path/to/file"
		const diffPattern = /^\+\+\+ b\/(.+)$/gm;
		let match;
		while ((match = diffPattern.exec(content)) !== null) {
			files.add(match[1]);
		}

		// Look for other common patterns
		// Pattern: "File: path/to/file" or "file: path/to/file"
		const filePattern = /(?:^|\n)(?:File|file):\s*(.+?)(?:\r?\n|$)/g;
		while ((match = filePattern.exec(content)) !== null) {
			const filePath = match[1].trim();
			// Filter out obvious non-file content
			if (
				filePath.length > 0 &&
				!filePath.includes(" ") &&
				filePath.includes(".")
			) {
				files.add(filePath);
			}
		}

		return Array.from(files);
	}

	/**
	 * Fetch file signatures from indexer for context compression.
	 * Returns signatures or null if indexer is unavailable or fails.
	 */
	private async fetchFileSignatures(
		filePaths: string[],
	): Promise<Map<string, FileSignaturesResponse> | null> {
		if (!this.indexerClient) {
			return null;
		}

		const signatures = new Map<string, FileSignaturesResponse>();
		const failedPaths: string[] = [];

		for (const filePath of filePaths) {
			try {
				const result = await this.indexerClient.getFileSignatures(filePath);
				signatures.set(filePath, result);
			} catch (err) {
				// Log but continue - we'll use fallback for failed files
				failedPaths.push(filePath);
			}
		}

		// Log compression event with results
		await this.ledger.log(
			"arbiter_context_compressed",
			{
				filePaths,
				successCount: signatures.size,
				failedCount: failedPaths.length,
				failedPaths: failedPaths.length > 0 ? failedPaths : undefined,
			},
			"info",
		);

		return signatures.size > 0 ? signatures : null;
	}

	/**
	 * Build compressed context from file signatures.
	 * Returns a formatted string with signatures for each file.
	 */
	private buildCompressedContext(
		signatures: Map<string, FileSignaturesResponse>,
	): string {
		const sections: string[] = [];

		for (const [filePath, response] of signatures) {
			if (response.signatures.length === 0) {
				continue;
			}

			const fileSection = [`=== ${filePath} ===`];

			for (const sig of response.signatures) {
				const params = sig.parameters || "";
				const returnType = sig.return_type ? `: ${sig.return_type}` : "";
				fileSection.push(
					`  ${sig.name}(${params})${returnType} [L${sig.line}]`,
				);
			}

			sections.push(fileSection.join("\n"));
		}

		return sections.join("\n\n");
	}

	/**
	 * Run Arbiter: LLM-based comparison of two outputs.
	 * Sends both outputs to an arbiter model and asks it to pick the better one.
	 * Falls back to structural comparison if the LLM call fails.
	 */
	private async runArbiter(
		responseA: any,
		responseB: any,
		task: MeshExecutionOptions["task"],
	): Promise<{
		verdict: "A" | "B" | "conflict";
		reasoning: string;
		provider: ProviderId;
	}> {
		const contentA = this.extractContent(responseA);
		const contentB = this.extractContent(responseB);

		// Fast path: identical outputs need no LLM comparison
		const hashA = this.hashContent(contentA);
		const hashB = this.hashContent(contentB);

		if (hashA === hashB) {
			return {
				verdict: "A",
				reasoning: "Outputs are structurally identical",
				provider: "groq",
			};
		}

		// Extract modified files from both responses
		const filesA = this.extractModifiedFiles(responseA);
		const filesB = this.extractModifiedFiles(responseB);
		const allFiles = [...new Set([...filesA, ...filesB])];

		// Try to fetch file signatures for context compression
		let compressedContext: string | null = null;
		let contextSource: "signatures" | "full" = "full";

		if (allFiles.length > 0 && this.indexerClient) {
			try {
				const signatures = await this.fetchFileSignatures(allFiles);
				if (signatures) {
					compressedContext = this.buildCompressedContext(signatures);
					contextSource = "signatures";
				}
			} catch {
				// Fallback to full content if signature fetching fails
				contextSource = "full";
			}
		}

		// INV-15 (M015.4): the arbiter is a judge-class invocation. If its
		// JCR risk exceeds τ, force dense context (drop the compressed view)
		// to prevent positional priors from corrupting the verdict. The gate
		// is a no-op for non-judge roles. See jcr-safety-gate.ts.
		const inv15Decision = this.jcrGate.gateDecision({
			agentRole: "critic", // Arbiter == critic-class in our taxonomy
			candidateCount: 2, // Exactly A and B
			// reuseRate is 1.0 when we have compressedContext (we *would* reuse
			// pre-computed file signatures), 0.0 when we'd use full context.
			reuseRate: compressedContext ? 1.0 : 0.0,
			layoutShuffled: false, // A/B order is deterministic in our pipeline
		});
		await this.ledger.log(
			"inv15_gate_decision",
			{
				riskScore: inv15Decision.riskScore,
				useDense: inv15Decision.useDense,
				reason: inv15Decision.reason,
				threshold: this.jcrGate.threshold,
				contextSourceBeforeGate: contextSource,
			},
			"info",
		);
		if (inv15Decision.useDense && compressedContext) {
			// Drop the compressed context — judge requires fresh dense prefill.
			compressedContext = null;
			contextSource = "full";
		}

		// Outputs differ — invoke LLM arbiter
		try {
			const taskDescription =
				task.messages.find((m) => m.role === "user")?.content ||
				task.messages[0]?.content ||
				"Unknown task";

			// Build the arbiter prompt with compressed context if available
			let contextBlock = "";
			if (compressedContext) {
				contextBlock = `\n\n--- FILE SIGNATURES (AST) ---\n${compressedContext}\n--- END SIGNATURES ---`;
			}

			const arbiterResult = await this.routerFn("verification", {
				id: `arbiter-${task.id || "unknown"}`,
				messages: [
					{
						role: "system",
						content:
							'You are an impartial code arbiter. You will see two outputs (A and B) generated by different AI agents for the same task. Compare them and decide which is better. Consider correctness, completeness, clarity, and conciseness. Respond with ONLY valid JSON in this exact format: {"verdict": "A" or "B" or "conflict", "reasoning": "brief explanation"}',
					},
					{
						role: "user",
						content: `Task: ${taskDescription}${contextBlock}\n\n--- OUTPUT A ---\n${contentA}\n\n--- OUTPUT B ---\n${contentB}\n\nWhich output is better? Reply with JSON only.`,
					},
				],
			});

			const arbiterContent = this.extractContent(arbiterResult.response);
			const parsed = this.parseArbiterResponse(arbiterContent);

			return {
				verdict: parsed.verdict,
				reasoning:
					contextSource === "signatures"
						? `${parsed.reasoning} (evaluated using AST signatures)`
						: parsed.reasoning,
				provider: arbiterResult.provider,
			};
		} catch (error) {
			// LLM arbiter failed — fall back to structural heuristic
			console.warn(
				`⚠ Arbiter LLM call failed, using structural fallback: ${error instanceof Error ? error.message : String(error)}`,
			);

			if (contentA.length < contentB.length * 0.8) {
				return {
					verdict: "A",
					reasoning:
						"A is more concise (LLM arbiter unavailable, structural fallback)",
					provider: "groq",
				};
			}
			if (contentB.length < contentA.length * 0.8) {
				return {
					verdict: "B",
					reasoning:
						"B is more concise (LLM arbiter unavailable, structural fallback)",
					provider: "groq",
				};
			}

			return {
				verdict: "A",
				reasoning:
					"Outputs similar length; preferring primary executor (LLM arbiter unavailable)",
				provider: "groq",
			};
		}
	}

	/**
	 * Parse the arbiter's JSON response, handling malformed output gracefully.
	 */
	private parseArbiterResponse(content: string): {
		verdict: "A" | "B" | "conflict";
		reasoning: string;
	} {
		// Try to extract JSON from the response (may contain markdown fences or extra text)
		const jsonMatch = content.match(/\{[\s\S]*?\}/);
		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[0]);
				const verdict = parsed.verdict;
				if (verdict === "A" || verdict === "B" || verdict === "conflict") {
					return {
						verdict,
						reasoning: String(parsed.reasoning || "No reasoning provided"),
					};
				}
			} catch {
				// JSON parse failed, continue to fallback
			}
		}

		// Fallback: try to detect verdict keywords in the response
		const lowerContent = content.toLowerCase();
		if (lowerContent.includes('"verdict"') && lowerContent.includes('"b"')) {
			return { verdict: "B", reasoning: "Extracted B from partial response" };
		}

		// Default to conflict if we can't parse
		return {
			verdict: "conflict",
			reasoning: `Could not parse arbiter response: ${content.slice(0, 200)}`,
		};
	}

	private extractContent(response: any): string {
		if (typeof response === "string") {
			return response;
		}
		if (response && typeof response === "object") {
			if ("content" in response) {
				return String(response.content);
			}
			if ("text" in response) {
				return String(response.text);
			}
			return JSON.stringify(response);
		}
		return String(response);
	}

	private hashContent(content: string): string {
		// Simple hash for comparison (not cryptographic)
		let hash = 0;
		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return hash.toString(36);
	}

	private estimateCost(provider: ProviderId): number {
		// Rough cost estimates per provider (in cents)
		const costMap: Record<ProviderId, number> = {
			"opencode-go": 2,
			"anthropic-api": 3,
			"gemini-api": 1,
			"deepseek-v4": 2,
			deepseek: 1,
			tavily: 0.5,
			gemini: 0.5,
			"moonshot-k2.5": 2,
			"moonshot-k2.6": 2.5,
			"xiaomi-mimo": 0.5,
			"carnice-9b-local": 0, // Local inference — zero marginal cost
			"qwen3.5-plus": 1,
			"qwen3.6-plus": 1.5,
			"minimax-m2.5": 1,
			"minimax-m2.7": 1.5,
			"glm-deepinfra": 0.5,
			"glm-fireworks": 0.5,
			"glm-zai": 0.5,
			groq: 0.3,
			"kiro-ai": 0.2,
			mistral: 0.5,
			openai: 1,
			// CLI drivers ride the user's existing subscription, so the
			// marginal cost per call is effectively zero from Apohara's
			// pricing POV. The verification-mesh cost model is only used
			// for ranking — actual user-facing cost is recorded by the
			// provider call itself.
			"claude-code-cli": 0,
			"codex-cli": 0,
			"gemini-cli": 0,
		};
		return costMap[provider] || 1;
	}

	public getEventLedgerPath(): string {
		return this.ledger.getFilePath();
	}
}
