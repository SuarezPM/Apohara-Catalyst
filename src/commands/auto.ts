import { Command } from "commander";
import { routeTask, routeTaskWithFallback } from "../core/agent-router";
import { Consolidator } from "../core/consolidator";
import type { DecomposedTask } from "../core/decomposer";
import { TaskDecomposer } from "../core/decomposer";
import { IsolationEngine } from "../core/isolation";
import { EventLedger } from "../core/ledger";
import { Isolator } from "../core/sandbox";
import { StateMachine } from "../core/state";
import { SubagentManager } from "../core/subagent-manager";
import { SummaryGenerator } from "../core/summary";
import { VerificationMesh } from "../core/verification-mesh";
import { spawn } from "../lib/spawn";
import { GitHubClient } from "../providers/github";
import { ProviderRouter } from "../providers/router";

export const autoCommand = new Command("auto")
	.description(
		"Automatically decompose a prompt into atomic tasks and execute them in parallel worktrees",
	)
	.argument("<prompt>", "The prompt to auto-execute")
	.option(
		"-w, --worktrees <number>",
		"Number of worktree lanes (default: 3)",
		"3",
	)
	.option(
		"-s, --simulate-failure",
		"Simulate a 429 rate limit error on the first provider for demo/testing (default: false)",
		false,
	)
	.option(
		"--no-pr",
		"Skip GitHub PR creation (useful for local-only runs)",
		false,
	)
	.option(
		"--improve-self",
		"Use sandbox for test execution and VerificationMesh for high-complexity tasks; auto-commits passing tasks",
		false,
	)
	.action(
		async (
			prompt: string,
			options: {
				worktrees?: string;
				simulateFailure?: boolean;
				pr?: boolean;
				improveSelf?: boolean;
			},
		) => {
			const worktreePoolSize = parseInt(options.worktrees || "3", 10);
			const enablePr = options.pr ?? true;
			const improveSelf = options.improveSelf ?? false;

			console.log(`🚀 Starting apohara auto for: "${prompt}"`);
			console.log(`📊 Worktree pool size: ${worktreePoolSize}`);
			if (options.simulateFailure) {
				console.log(
					`⚠️  SIMULATE-FAILURE MODE ENABLED - First provider will return 429`,
				);
			}
			if (improveSelf) {
				console.log(
					`🔒 IMPROVE-SELF MODE: sandbox test execution + mesh verification + auto-commit`,
				);
			}

			// 1) Initialize core components
			const stateMachine = new StateMachine();
			const ledger = new EventLedger();
			const router = new ProviderRouter({
				simulateFailure: options.simulateFailure ?? false,
				eventLedger: ledger,
			});
			const decomposer = new TaskDecomposer(router);
			const subagentManager = new SubagentManager({
				maxConcurrent: worktreePoolSize,
				timeoutMs: 120000,
				maxRetries: 3,
				backoffMs: [1000, 4000, 16000],
			});

			// Improve-self components (initialized lazily when flag is set)
			const isolator = improveSelf ? new Isolator() : null;
			const verificationMesh = improveSelf ? new VerificationMesh() : null;

			try {
				// 2) Load or create state
				await stateMachine.load();
				const initialState = stateMachine.get();
				console.log(
					`📁 Loaded state: ${initialState.tasks.length} existing tasks`,
				);

				await ledger.log(
					"auto_command_started",
					{ prompt, worktreePoolSize },
					"info",
				);

				// 3) Decompose the prompt into atomic tasks
				console.log("🔄 Decomposing prompt into atomic tasks...");

				let decompositionResult: { tasks: DecomposedTask[] };
				try {
					decompositionResult = await decomposer.decompose(prompt);
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					console.error(`❌ Decomposition failed: ${errorMessage}`);
					console.log("\n💡 Make sure you have configured your API keys:");
					console.log("   apohara config");
					console.log("   or set environment variables:\n");
					console.log("   OPENCODE_API_KEY=your-key-here");
					console.log("   or\n   DEEPSEEK_API_KEY=your-key-here\n");
					await ledger.log(
						"auto_command_failed",
						{ prompt, error: errorMessage },
						"error",
					);
					process.exit(1);
				}

				console.log(
					`✨ Decomposed into ${decompositionResult.tasks.length} tasks:`,
				);
				for (const task of decompositionResult.tasks) {
					const deps =
						task.dependencies.length > 0
							? ` (depends on: ${task.dependencies.join(", ")})`
							: "";
					console.log(`   - [${task.id}] ${task.description}${deps}`);
				}

				await ledger.log(
					"decomposition_completed",
					{
						taskCount: decompositionResult.tasks.length,
						tasks: decompositionResult.tasks.map((t) => t.id),
					},
					"info",
				);

				// 4) Execute tasks via SubagentManager (parallel with dependency resolution)
				console.log("▶️ Executing tasks in parallel via SubagentManager...");
				const agentResults = await subagentManager.executeAll(
					decompositionResult.tasks,
				);

				// 4b) Improve-self: sandbox test runs + mesh verification + auto-commit
				if (improveSelf && isolator && verificationMesh) {
					await runImproveSelf(
						decompositionResult.tasks,
						isolator,
						verificationMesh,
						ledger,
					);
				}

				// 5) Report results
				const successCount = agentResults.filter(
					(r) => r.status === "completed",
				).length;
				const errorCount = agentResults.filter(
					(r) => r.status === "failed" || r.status === "timeout",
				).length;

				console.log("\n📋 Task Results:");
				for (const result of agentResults) {
					const statusIcon = result.status === "completed" ? "✅" : "❌";
					console.log(
						`   ${statusIcon} [${result.taskId}] ${result.status} (provider: ${result.provider}, ${result.durationMs}ms)`,
					);
				}

				console.log(
					`\n📊 Summary: ${successCount} succeeded, ${errorCount} failed, ${agentResults.length} total`,
				);

				await ledger.log(
					"auto_command_completed",
					{
						successCount,
						errorCount,
						totalTasks: agentResults.length,
						results: agentResults.map((r) => ({
							taskId: r.taskId,
							status: r.status,
							provider: r.provider,
						})),
					},
					errorCount > 0 ? "warning" : "info",
				);

				// 6) Run consolidation: create branch, merge worktrees, generate summary
				console.log("\n🔀 Running consolidation...");
				const consolidator = new Consolidator({}, ledger);
				const consolidationResult = await consolidator.run();
				await ledger.log(
					"consolidation_completed",
					{
						branch: consolidationResult.branch,
						exitCode: consolidationResult.exitCode,
						successfulWorktrees: consolidationResult.successfulWorktrees,
						failedWorktrees: consolidationResult.failedWorktrees,
					},
					consolidationResult.exitCode === 0 ? "info" : "warning",
				);

				// 7) Run Biome linting on consolidated code
				console.log("🔧 Running Biome linting...");
				const lintResult = await runBiomeLint();
				await ledger.log(
					"lint_applied",
					{
						exitCode: lintResult.exitCode,
						fixed: lintResult.fixed,
						output: lintResult.output,
					},
					lintResult.exitCode === 0 ? "info" : "warning",
				);

				if (lintResult.fixed > 0) {
					console.log(`   ✨ Fixed ${lintResult.fixed} issue(s)`);
				} else {
					console.log(`   ✅ No lint issues`);
				}

				// 9) Create GitHub Pull Request from consolidated branch
				console.log("🔗 Creating GitHub Pull Request...");
				const prResult = await createGitHubPullRequest(
					consolidationResult.branch,
					ledger,
					enablePr,
				);
				if (prResult) {
					await ledger.log(
						"github_pr_created",
						{
							prNumber: prResult.number,
							prUrl: prResult.htmlUrl,
							branch: consolidationResult.branch,
						},
						"info",
					);
					console.log(
						`   ✅ PR #${prResult.number} created: ${prResult.htmlUrl}`,
					);
				}

				// 10) Generate narrative summary from EventLedger and StateMachine
				console.log("📝 Generating summary...");
				const runId =
					ledger
						.getFilePath()
						.split("/")
						.pop()
						?.replace("run-", "")
						?.replace(".jsonl", "") || undefined;
				const summaryGenerator = new SummaryGenerator({ runId });
				const summaryPath = await summaryGenerator.generate();
				await ledger.log("summary_generated", { summaryPath }, "info");

				console.log("\n🎉 Auto execution complete!");
				console.log(`   📂 Branch: ${consolidationResult.branch}`);
				console.log(
					`   🧹 Worktrees: ${consolidationResult.successfulWorktrees.length} merged, ${consolidationResult.failedWorktrees.length} failed`,
				);
				console.log(`   📊 Summary: ${summaryPath}`);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.error(`❌ Auto command failed: ${errorMessage}`);

				await ledger.log(
					"auto_command_failed",
					{ prompt, error: errorMessage },
					"error",
				);

				process.exit(1);
			} finally {
				console.log("👋 Shutdown complete.");
			}
		},
	);

/**
 * Improve-self execution loop:
 * 1. Run tests via Isolator.exec() (sandboxed) for each completed task
 * 2. For tasks with complexity ∈ {high, critical} AND filesModified ≥ 3, run VerificationMesh
 * 3. Auto-commit tasks that pass sandbox + mesh with a structured message and GSD-Task trailer
 */
async function runImproveSelf(
	tasks: DecomposedTask[],
	isolator: Isolator,
	verificationMesh: VerificationMesh,
	ledger: EventLedger,
): Promise<void> {
	const workdir = process.cwd();

	for (const task of tasks) {
		// Sandbox test run
		const sandboxResult = await isolator.exec({
			workdir,
			command: "bun test",
			permission: "workspace_write",
			timeout: 60000,
			taskId: task.id,
		});

		await ledger.log(
			"sandbox_test_run",
			{
				taskId: task.id,
				exitCode: sandboxResult.exitCode,
				durationMs: sandboxResult.durationMs,
				error: sandboxResult.error,
			},
			sandboxResult.exitCode === 0 ? "info" : "warning",
			task.id,
		);

		// Only proceed to mesh + commit if tests passed
		if (sandboxResult.exitCode !== 0) {
			console.log(
				`   ⚠️  [${task.id}] Tests failed in sandbox — skipping commit`,
			);
			await ledger.log(
				"improve_self_task_completed",
				{
					taskId: task.id,
					sandboxExitCode: sandboxResult.exitCode,
					meshApplied: false,
					committed: false,
					skipReason: "sandbox_tests_failed",
				},
				"warning",
				task.id,
			);
			continue;
		}

		const complexity =
			(task as unknown as { complexity?: string }).complexity ?? "medium";
		const filesModified =
			(task as unknown as { filesModified?: number }).filesModified ?? 0;
		const qualifiesForMesh =
			(complexity === "high" || complexity === "critical") &&
			filesModified >= 3;

		let meshApplied = false;
		let meshCostDelta = 0;

		if (qualifiesForMesh) {
			const meshResult = await verificationMesh.execute({
				taskId: task.id,
				role: "execution",
				task: {
					id: task.id,
					messages: [
						{
							role: "user",
							content: task.description,
						},
					],
					complexity: complexity as "low" | "medium" | "high" | "critical",
					filesModified,
				},
				policy: {
					enabled: true,
					max_extra_cost_pct: 15,
					min_complexity: "high",
				},
			});

			meshApplied = meshResult.meshApplied;
			meshCostDelta = meshResult.meshCostDelta ?? 0;

			// Abort commit if mesh selected Agent B and B produced a different result
			if (meshResult.meshApplied && meshResult.arbiter?.verdict === "B") {
				console.log(
					`   🔀 [${task.id}] Mesh selected Agent B output — reviewing before commit`,
				);
			}
		}

		// Auto-commit: task passed sandbox tests (and mesh if applicable)
		const commitMessage = buildCommitMessage(task, {
			meshApplied,
			filesModified,
			complexity,
		});
		const committed = await gitCommitTask(workdir, task.id, commitMessage);

		await ledger.log(
			"improve_self_task_completed",
			{
				taskId: task.id,
				sandboxExitCode: sandboxResult.exitCode,
				meshApplied,
				meshCostDelta,
				committed,
			},
			"info",
			task.id,
		);

		const meshTag = meshApplied ? " [mesh-verified]" : "";
		const commitTag = committed
			? " [committed]"
			: " [commit-skipped: nothing staged]";
		console.log(`   ✅ [${task.id}]${meshTag}${commitTag}`);
	}
}

function buildCommitMessage(
	task: DecomposedTask,
	meta: { meshApplied: boolean; filesModified: number; complexity: string },
): string {
	const body = [
		`sandbox: tests passed`,
		meta.meshApplied ? `mesh: verified` : null,
		`complexity: ${meta.complexity}`,
		`files-modified: ${meta.filesModified}`,
	]
		.filter(Boolean)
		.join("\n");

	return `feat: ${task.description}\n\n${body}\n\nGSD-Task: improve-self/${task.id}`;
}

/**
 * Stages all modified tracked files and commits with the given message.
 * Returns true if a commit was made, false if nothing was staged.
 */
async function gitCommitTask(
	workdir: string,
	taskId: string,
	message: string,
): Promise<boolean> {
	// Stage all tracked modifications (not untracked — keeps write-only room doctrine)
	const addProc = spawn(["git", "add", "-u"], {
		stdout: "pipe",
		stderr: "pipe",
		cwd: workdir,
	});
	await addProc.exited;

	// Check if there's anything staged
	const statusProc = spawn(["git", "diff", "--cached", "--quiet"], {
		stdout: "pipe",
		stderr: "pipe",
		cwd: workdir,
	});
	const statusCode = await statusProc.exited;

	if (statusCode === 0) {
		// exit 0 means no diff — nothing to commit
		return false;
	}

	const commitProc = spawn(["git", "commit", "-m", message], {
		stdout: "pipe",
		stderr: "pipe",
		cwd: workdir,
	});
	const commitCode = await commitProc.exited;

	return commitCode === 0;
}

/**
 * Runs Biome linting on the consolidated code with autofix.
 */
async function runBiomeLint(): Promise<{
	exitCode: number;
	fixed: number;
	output: string;
}> {
	const proc = spawn(["biome", "check", "--fix", ".", "--verbose"], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	const stdout = await proc.stdout.text();
	const stderr = await proc.stderr.text();

	const fixedMatch =
		stdout.match(/Fixed (\d+) issues?/) || stderr.match(/Fixed (\d+) issues?/);
	const fixed = fixedMatch ? parseInt(fixedMatch[1], 10) : 0;

	return {
		exitCode,
		fixed,
		output: stdout + stderr,
	};
}

/**
 * Creates a GitHub Pull Request from the consolidated branch.
 */
async function createGitHubPullRequest(
	headBranch: string,
	ledger: EventLedger,
	enablePr: boolean = true,
): Promise<{
	number: number;
	htmlUrl: string;
} | null> {
	if (!enablePr) {
		await ledger.log(
			"github_pr_skipped",
			{ reason: "user opted out via --no-pr flag" },
			"info",
		);
		console.log("   ⏭️  Skipped PR creation: --no-pr flag set");
		return null;
	}

	const github = new GitHubClient();

	const repoInfo = await github.getRepositoryFromRemote();
	if (!repoInfo?.repoInfo) {
		await ledger.log(
			"github_pr_skipped",
			{ reason: "Could not detect repository from git remote" },
			"warning",
		);
		console.log("   ⚠️  Skipped PR creation: no GitHub remote detected");
		return null;
	}

	const tokenValidation = github.validateToken();
	if (!tokenValidation.valid) {
		await ledger.log(
			"github_pr_skipped",
			{ reason: tokenValidation.error },
			"warning",
		);
		console.log(`   ⚠️  Skipped PR creation: ${tokenValidation.error}`);
		return null;
	}

	try {
		const pr = await github.createPullRequest({
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			title: `Auto: ${headBranch}`,
			body: `Changes consolidated from Clarity auto execution.\n\nBranch: ${headBranch}`,
			head: headBranch,
			base: repoInfo.repoInfo.defaultBranch,
		});

		return {
			number: pr.number,
			htmlUrl: pr.htmlUrl,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ledger.log("github_pr_error", { error: message }, "error");
		console.log(`   ⚠️  Failed to create PR: ${message}`);
		return null;
	}
}
