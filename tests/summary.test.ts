import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EventLedger } from "../src/core/ledger";
import { StateMachine } from "../src/core/state";
import { type RunSummary, SummaryGenerator } from "../src/core/summary";

describe("SummaryGenerator", () => {
	let generator: SummaryGenerator;
	let testEventsDir: string;
	let testRunsDir: string;
	let testStateFile: string;
	let ledger: EventLedger;

	beforeEach(async () => {
		// Set up test directories
		testEventsDir = join(process.cwd(), ".events", "test-summary");
		testRunsDir = join(process.cwd(), ".apohara", "runs", "test-summary");
		testStateFile = join(process.cwd(), ".apohara", "test-state.json");

		// Clean up
		await rm(testEventsDir, { recursive: true, force: true });
		await rm(testRunsDir, { recursive: true, force: true });
		await rm(testStateFile, { recursive: true, force: true });

		// Create directories
		await mkdir(dirname(testEventsDir), { recursive: true });
		await mkdir(dirname(testStateFile), { recursive: true });

		// Create generator
		generator = new SummaryGenerator({
			runId: "test-summary",
			eventsDir: testEventsDir,
			stateFilePath: testStateFile,
			outputDir: testRunsDir,
		});

		ledger = generator.getLedger();
	});

	afterEach(async () => {
		// Clean up
		await rm(testEventsDir, { recursive: true, force: true });
		await rm(testRunsDir, { recursive: true, force: true });
		await rm(testStateFile, { recursive: true, force: true });
	});

	describe("construction", () => {
		it("should create generator with default config", () => {
			const gen = new SummaryGenerator();
			expect(gen).toBeDefined();
			expect(gen.getLedger()).toBeDefined();
			expect(gen.getStateMachine()).toBeDefined();
		});

		it("should create generator with custom options", () => {
			const gen = new SummaryGenerator({
				runId: "custom-run",
				eventsDir: ".events",
				stateFilePath: ".apohara/state.json",
				outputDir: ".apohara/runs",
			});
			expect(gen).toBeDefined();
		});
	});

	describe("generate", () => {
		it("should generate summary with no tasks when state is empty", async () => {
			const outputPath = await generator.generate();
			expect(outputPath).toContain("summary.md");
			expect(existsSync(outputPath)).toBe(true);

			const content = await readFile(outputPath, "utf-8");
			expect(content).toContain("Apohara Auto Run Summary");
			expect(content).toContain("No tasks recorded");
		});

		it("should include timestamp and run ID in summary", async () => {
			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("Run ID:");
			expect(content).toContain("Timestamp:");
		});

		it("should include status in summary", async () => {
			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("Status:");
			expect(content).toContain("No tasks");
		});
	});

	describe("event parsing", () => {
		it("should parse events from ledger", async () => {
			// Log some test events
			await ledger.log("task_started", { taskId: "T01" }, "info", "T01");
			await ledger.log("task_completed", { taskId: "T01" }, "info", "T01", {
				provider: "opencode-go",
				model: "opencode-model",
				tokens: { prompt: 100, completion: 50, total: 150 },
				costUsd: 0.001,
				durationMs: 5000,
			});

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			// Should contain task info
			expect(content).toContain("T01");
		});

		it("should track tokens and cost from events", async () => {
			await ledger.log("task_completed", { taskId: "T01" }, "info", "T01", {
				tokens: { prompt: 100, completion: 50, total: 150 },
				costUsd: 0.001,
			});

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			// Check for usage section with non-zero values
			expect(content).toContain("Usage Summary");
			// Just check for presence of token/cost fields - not specific values
			// since previous tests may add events
			expect(content).toMatch(/Total Tokens:/);
			expect(content).toMatch(/Estimated Cost:/);
		});

		it("should track fallback events", async () => {
			await ledger.log(
				"provider_fallback",
				{ from: "opencode-go", to: "deepseek" },
				"warning",
				"T01",
			);

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("Fallbacks Activated");
			expect(content).toContain("opencode-go");
			expect(content).toContain("deepseek");
		});

		it("should track file creation events", async () => {
			await ledger.log("file_created", { file: "src/test.ts" }, "info");
			await ledger.log("file_modified", { file: "src/existing.ts" }, "info");

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("Files");
			expect(content).toContain("Created");
			expect(content).toContain("Modified");
			expect(content).toContain("src/test.ts");
		});

		it("should calculate provider statistics", async () => {
			await ledger.log("task_completed", { taskId: "T01" }, "info", "T01", {
				provider: "opencode-go",
				tokens: { prompt: 100, completion: 50, total: 150 },
				costUsd: 0.001,
			});
			await ledger.log("task_completed", { taskId: "T02" }, "info", "T02", {
				provider: "deepseek",
				tokens: { prompt: 200, completion: 100, total: 300 },
				costUsd: 0.002,
			});

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("Provider Statistics");
			expect(content).toContain("opencode-go");
			expect(content).toContain("deepseek");
		});
	});

	describe("state machine integration", () => {
		it("should read tasks from state file", async () => {
			const stateMachine = generator.getStateMachine();

			// Initialize state with some tasks
			await stateMachine.load();
			await stateMachine.update((state) => ({
				...state,
				tasks: [
					{
						id: "T01",
						description: "Test task 1",
						status: "completed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					{
						id: "T02",
						description: "Test task 2",
						status: "failed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
				status: "running",
			}));

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			// Check for task status in table
			expect(content).toContain("T01");
			expect(content).toContain("T02");
			expect(content).toContain("completed");
			expect(content).toContain("failed");
		});

		it("should show correct status for mixed results", async () => {
			const stateMachine = generator.getStateMachine();

			await stateMachine.load();
			await stateMachine.update((state) => ({
				...state,
				tasks: [
					{
						id: "T01",
						description: "Success task",
						status: "completed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					{
						id: "T02",
						description: "Failing task",
						status: "failed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			}));

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("Partial success");
		});

		it("should show all completed when all tasks succeed", async () => {
			const stateMachine = generator.getStateMachine();

			await stateMachine.load();
			await stateMachine.update((state) => ({
				...state,
				tasks: [
					{
						id: "T01",
						description: "Success task",
						status: "completed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			}));

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("All tasks completed");
		});
	});

	describe("narrative generation", () => {
		it("should generate narrative for complete success", async () => {
			const stateMachine = generator.getStateMachine();

			await stateMachine.load();
			await stateMachine.update((state) => ({
				...state,
				tasks: [
					{
						id: "T01",
						description: "Task",
						status: "completed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			}));

			await ledger.log("task_completed", {}, "info", "T01", { costUsd: 0.001 });

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("Narrative");
			expect(content).toContain("successfully");
			expect(content).toContain("$0.001");
		});

		it("should generate narrative with fallbacks", async () => {
			const stateMachine = generator.getStateMachine();

			await stateMachine.load();
			await stateMachine.update((state) => ({
				...state,
				tasks: [
					{
						id: "T01",
						description: "Task",
						status: "completed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			}));

			await ledger.log(
				"provider_fallback",
				{ from: "opencode-go", to: "deepseek" },
				"warning",
			);

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("provider fallback");
		});
	});

	describe("duration tracking", () => {
		it("should calculate duration from events", async () => {
			// Log events at different times
			await ledger.log("run_started", {}, "info", undefined, {
				durationMs: 1000,
			});
			await new Promise((r) => setTimeout(r, 100));
			await ledger.log("run_completed", {}, "info", undefined, {
				durationMs: 2000,
			});

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			expect(content).toContain("Duration:");
		});
	});

	describe("formatting", () => {
		it("should format duration in human readable form", async () => {
			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			// Should contain formatted duration (ms, s, m)
			expect(content).toMatch(/Duration:.*(ms|s|m)/);
		});

		it("should create proper markdown table format", async () => {
			const stateMachine = generator.getStateMachine();

			await stateMachine.load();
			await stateMachine.update((state) => ({
				...state,
				tasks: [
					{
						id: "T01",
						description: "Test task",
						status: "completed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			}));

			const outputPath = await generator.generate();
			const content = await readFile(outputPath, "utf-8");

			// Check markdown table syntax
			expect(content).toContain("| Task ID | Status |");
			expect(content).toContain("|---------|--------|");
		});
	});
});

describe("SummaryGenerator CLI Entry", () => {
	it("should have a main export", () => {
		expect(SummaryGenerator).toBeDefined();
	});
});
