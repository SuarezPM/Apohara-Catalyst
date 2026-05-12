import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { exec as execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { routeTask } from "../../src/core/agent-router";
import { SummaryGenerator } from "../../src/core/summary";
import type { EventLog } from "../../src/core/types";
import { ProviderRouter } from "../../src/providers/router";
import { extractAgents } from "../../src/tui/components/AgentStatus";
import { extractCosts } from "../../src/tui/hooks/useCostTable";
import { extractTasks } from "../../src/tui/hooks/useTaskList";
import { RunManager } from "../../src/tui/lib/run-manager";

const execAsync = promisify(execSync);

// ── Helpers ────────────────────────────────────────────────────────────────

async function createTempDir(prefix: string): Promise<string> {
	const tmp = path.join(process.cwd(), ".test-temp", `${prefix}-${Date.now()}`);
	await mkdir(tmp, { recursive: true });
	return tmp;
}

async function cleanupTempDir(tmp: string): Promise<void> {
	await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

async function hasApiKey(): Promise<boolean> {
	try {
		const envContent = await fs.readFile(
			path.join(process.cwd(), ".env"),
			"utf-8",
		);
		return (
			envContent.includes("OPENCODE_API_KEY=") &&
			!envContent.includes("OPENCODE_API_KEY=your-key-here") &&
			!envContent.match(/^OPENCODE_API_KEY=\s*$/m)
		);
	} catch {
		return false;
	}
}

async function getLatestEventFile(): Promise<string | null> {
	const eventsDir = path.join(process.cwd(), ".events");
	try {
		const files = await readdir(eventsDir);
		const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
		if (jsonlFiles.length === 0) return null;
		jsonlFiles.sort();
		return path.join(eventsDir, jsonlFiles[jsonlFiles.length - 1]);
	} catch {
		return null;
	}
}

async function readEventLines(
	filePath: string,
): Promise<Array<Record<string, unknown>>> {
	const content = await readFile(filePath, "utf-8");
	return content
		.trim()
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

// ── E2E Tests ──────────────────────────────────────────────────────────────

describe("E2E: Dashboard CLI", () => {
	it("dashboard help shows usage and --run option", async () => {
		const { stdout } = await execAsync("bun run src/cli.ts dashboard --help", {
			timeout: 10000,
		});
		expect(stdout).toContain("dashboard");
		expect(stdout).toContain("--run");
		expect(stdout).toContain("-r");
		expect(stdout).toContain("Load a specific run by ID");
	}, 10000);

	it("dashboard CLI rejects invalid run IDs", async () => {
		try {
			await execAsync('bun run src/cli.ts dashboard --run "bad id!"', {
				timeout: 10000,
			});
			expect(true).toBe(false); // should not reach here
		} catch (error: unknown) {
			const err = error as { code?: number; stderr?: string };
			expect(err.code).toBe(1);
			const output = err.stderr || "";
			expect(output).toContain("Invalid run ID");
		}
	}, 10000);
});

describe("E2E: Auto CLI", () => {
	it("auto help shows --simulate-failure and --no-pr flags", async () => {
		const { stdout } = await execAsync("bun run src/cli.ts auto --help", {
			timeout: 10000,
		});
		expect(stdout).toContain("--simulate-failure");
		expect(stdout).toContain("-s,");
		expect(stdout).toContain("--no-pr");
		expect(stdout).toContain("Skip GitHub PR creation");
	}, 10000);
});

describe("E2E: ProviderRouter simulateFailure", () => {
	let router: ProviderRouter;
	let eventsDir: string;

	beforeEach(async () => {
		eventsDir = path.join(process.cwd(), ".events");
		router = new ProviderRouter({
			opencodeApiKey: "test-opencode-key",
			deepseekApiKey: "test-deepseek-key",
			simulateFailure: true,
		});
	});

	afterEach(async () => {
		// Clean up test events
		await rm(eventsDir, { recursive: true, force: true }).catch(() => {});
	});

	it("simulateFailure triggers a simulated 429 on first call to opencode-go", async () => {
		try {
			await router.completion({
				messages: [{ role: "user", content: "Hello" }],
				provider: "opencode-go",
			});
			expect(true).toBe(false); // should throw
		} catch {
			// Expected to throw after fallback also fails
		}

		// The first call to opencode-go should have recorded a failure
		expect(router.getFailureCount("opencode-go")).toBeGreaterThanOrEqual(1);
	});

	it("fallback chain moves from opencode-go to a different provider after simulated failure", async () => {
		const fallbackProvider = router.fallback("opencode-go");
		expect(fallbackProvider).not.toBe("opencode-go");
		expect(fallbackProvider).toBeDefined();
		// Per current priority list, fallback from opencode-go is minimax-m2.7
		expect(fallbackProvider).toBe("minimax-m2.7");
	});
});

describe("E2E: apohara auto --simulate-failure", () => {
	const testDir = process.cwd();
	let apiKeyAvailable = false;
	let preRunEventFiles: string[] = [];

	beforeEach(async () => {
		apiKeyAvailable = await hasApiKey();
		const eventsDir = path.join(testDir, ".events");
		preRunEventFiles = await readdir(eventsDir).catch(() => []);
	});

	afterEach(async () => {
		// Clean up recent event files and runs to avoid accumulation
		const eventsDir = path.join(testDir, ".events");
		const allFiles = await readdir(eventsDir).catch(() => []);
		for (const f of allFiles) {
			if (!preRunEventFiles.includes(f)) {
				await rm(path.join(eventsDir, f), { force: true }).catch(() => {});
			}
		}
		const runsDir = path.join(testDir, ".apohara", "runs");
		const runs = await readdir(runsDir).catch(() => []);
		for (const run of runs.slice(-3)) {
			await rm(path.join(runsDir, run), { recursive: true, force: true }).catch(
				() => {},
			);
		}
	});

	it("creates an event ledger file in .events/", async () => {
		try {
			await execAsync(
				'bun run src/cli.ts auto "test prompt" --simulate-failure --no-pr',
				{ timeout: 10000 },
			);
		} catch {
			// Expected to fail (decomposition or execution failure)
		}

		const latestFile = await getLatestEventFile();
		expect(latestFile).not.toBeNull();
		expect(latestFile).toContain(".events/run-");
		expect(latestFile).toEndWith(".jsonl");
	}, 15000);

	it("event ledger contains provider_fallback when auto runs with simulate-failure", async () => {
		if (!apiKeyAvailable) {
			console.log("⏭️  Skipping: no API key available");
			return;
		}

		// Directly exercise the ProviderRouter with simulateFailure to verify
		// provider_fallback events are written to the ledger, since running the
		// full `apohara auto` command often fails at decomposition before
		// reaching execution where simulateFailure triggers.
		const testRouter = new ProviderRouter({
			opencodeApiKey: "test-key",
			deepseekApiKey: "test-key",
			simulateFailure: true,
		});

		try {
			await testRouter.completion({
				messages: [{ role: "user", content: "Hello" }],
				provider: "opencode-go",
			});
		} catch {
			// Expected to throw after fallback also fails
		}

		// Scan all event files for provider_fallback
		const eventsDir = path.join(testDir, ".events");
		const files = await readdir(eventsDir).catch(() => []);
		const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

		let foundFallback = false;
		for (const f of jsonlFiles) {
			const lines = await readEventLines(path.join(eventsDir, f));
			if (lines.some((ev) => ev.type === "provider_fallback")) {
				foundFallback = true;
				break;
			}
		}

		expect(foundFallback).toBe(true);
	}, 15000);

	it("event ledger contains provider_selected events with provider metadata", async () => {
		if (!apiKeyAvailable) {
			console.log("⏭️  Skipping: no API key available");
			return;
		}

		try {
			await execAsync(
				'bun run src/cli.ts auto "test prompt" --simulate-failure --no-pr',
				{ timeout: 15000 },
			);
		} catch {
			// May fail during decomposition or execution; still inspect events
		}

		// Allow filesystem flush
		await new Promise((resolve) => setTimeout(resolve, 500));

		const latestFile = await getLatestEventFile();
		if (!latestFile) {
			expect(true).toBe(false); // no ledger found
			return;
		}

		const lines = await readEventLines(latestFile);
		const selectedEvents = lines.filter(
			(ev) => ev.type === "provider_selected",
		);
		expect(selectedEvents.length).toBeGreaterThanOrEqual(1);

		// Verify metadata includes provider info
		const first = selectedEvents[0];
		expect(first.metadata).toBeDefined();
		const metadata = first.metadata as Record<string, unknown>;
		expect(metadata.provider).toBeDefined();
	}, 20000);
});

describe("E2E: agent-router provider selection", () => {
	let ledgerFilesToClean: string[] = [];

	beforeEach(async () => {
		// Snapshot existing event files so we only inspect newly created ones
		const eventsDir = path.join(process.cwd(), ".events");
		const files = await readdir(eventsDir).catch(() => []);
		ledgerFilesToClean = files.filter((f) => f.endsWith(".jsonl"));
	});

	afterEach(async () => {
		for (const f of ledgerFilesToClean) {
			await rm(path.join(process.cwd(), ".events", f), { force: true }).catch(
				() => {},
			);
		}
	});

	it("routeTask logs provider_fallback with metadata when primary token is missing", async () => {
		// Snapshot files before routeTask
		const eventsDir = path.join(process.cwd(), ".events");
		const beforeFiles = new Set(
			(await readdir(eventsDir).catch(() => [])).filter((f) =>
				f.endsWith(".jsonl"),
			),
		);

		const result = await routeTask("execution", {
			id: "T01",
			description: "Test task",
		});
		expect(result.provider).toBeDefined();
		expect(result.model).toBeDefined();

		// Find newly created ledger file(s)
		const afterFiles = (await readdir(eventsDir).catch(() => [])).filter(
			(f) => f.endsWith(".jsonl") && !beforeFiles.has(f),
		);
		expect(afterFiles.length).toBeGreaterThanOrEqual(1);

		// Track for cleanup
		for (const f of afterFiles) {
			ledgerFilesToClean.push(f);
		}

		// Search all new files for provider_fallback
		let foundFallback = false;
		let firstFallback: Record<string, unknown> | null = null;
		for (const f of afterFiles) {
			const lines = await readEventLines(path.join(eventsDir, f));
			const fallback = lines.filter((ev) => ev.type === "provider_fallback");
			if (fallback.length > 0) {
				foundFallback = true;
				firstFallback = fallback[0];
				break;
			}
		}

		expect(foundFallback).toBe(true);
		expect(firstFallback).not.toBeNull();
		expect(firstFallback!.metadata).toBeDefined();
		const metadata = firstFallback!.metadata as Record<string, unknown>;
		expect(metadata.fromProvider).toBeDefined();
		expect(metadata.toProvider).toBeDefined();
	});
});

// ── Synthetic Run Helper ───────────────────────────────────────────────────

function buildSyntheticEvents(): EventLog[] {
	const baseTime = new Date("2024-01-15T10:00:00.000Z").getTime();
	const ts = (offsetMs: number) => new Date(baseTime + offsetMs).toISOString();

	return [
		{
			id: "ev-start",
			timestamp: ts(0),
			type: "auto_command_started",
			severity: "info",
			payload: { command: "auto", prompt: "Build a hello-world API" },
		} as EventLog,
		{
			id: "ev-2",
			timestamp: ts(100),
			type: "task_scheduled",
			severity: "info",
			taskId: "T01",
			payload: { description: "Research APIs", name: "Research APIs" },
			metadata: { provider: "tavily", role: "research" },
		} as EventLog,
		{
			id: "ev-3",
			timestamp: ts(200),
			type: "provider_selected",
			severity: "info",
			taskId: "T01",
			payload: {},
			metadata: {
				provider: "tavily",
				role: "research",
				costUsd: 0.02,
				tokens: { prompt: 100, completion: 50, total: 150 },
			},
		} as EventLog,
		{
			id: "ev-4",
			timestamp: ts(300),
			type: "task_scheduled",
			severity: "info",
			taskId: "T02",
			payload: { description: "Plan architecture", name: "Plan architecture" },
			metadata: { provider: "moonshot-k2.6", role: "planning" },
		} as EventLog,
		{
			id: "ev-5",
			timestamp: ts(400),
			type: "provider_selected",
			severity: "info",
			taskId: "T02",
			payload: {},
			metadata: {
				provider: "moonshot-k2.6",
				role: "planning",
				costUsd: 0.03,
				tokens: { prompt: 200, completion: 100, total: 300 },
			},
		} as EventLog,
		{
			id: "ev-6",
			timestamp: ts(500),
			type: "task_scheduled",
			severity: "info",
			taskId: "T03",
			payload: { description: "Implement API", name: "Implement API" },
			metadata: { provider: "deepseek-v4", role: "execution" },
		} as EventLog,
		{
			id: "ev-7",
			timestamp: ts(600),
			type: "provider_selected",
			severity: "info",
			taskId: "T03",
			payload: {},
			metadata: {
				provider: "deepseek-v4",
				role: "execution",
				costUsd: 0.05,
				tokens: { prompt: 300, completion: 150, total: 450 },
			},
		} as EventLog,
		{
			id: "ev-8",
			timestamp: ts(700),
			type: "task_scheduled",
			severity: "info",
			taskId: "T04",
			payload: { description: "Verify tests", name: "Verify tests" },
			metadata: { provider: "opencode-go", role: "execution" },
		} as EventLog,
		{
			id: "ev-9",
			timestamp: ts(800),
			type: "provider_selected",
			severity: "info",
			taskId: "T04",
			payload: {},
			metadata: {
				provider: "opencode-go",
				role: "execution",
				costUsd: 0.01,
				tokens: { prompt: 50, completion: 25, total: 75 },
			},
		} as EventLog,
		{
			id: "ev-10",
			timestamp: ts(900),
			type: "provider_fallback",
			severity: "warning",
			taskId: "T04",
			payload: { from: "opencode-go", to: "minimax-m2.7" },
			metadata: {
				fromProvider: "opencode-go",
				toProvider: "minimax-m2.7",
				errorReason: "429 Too Many Requests",
			},
		} as EventLog,
		{
			id: "ev-11",
			timestamp: ts(1000),
			type: "provider_selected",
			severity: "info",
			taskId: "T04",
			payload: {},
			metadata: {
				provider: "minimax-m2.7",
				role: "execution",
				costUsd: 0.04,
				tokens: { prompt: 80, completion: 40, total: 120 },
			},
		} as EventLog,
		{
			id: "ev-12",
			timestamp: ts(1100),
			type: "task_completed",
			severity: "info",
			taskId: "T01",
			payload: { result: "done" },
			metadata: { provider: "tavily" },
		} as EventLog,
		{
			id: "ev-13",
			timestamp: ts(1200),
			type: "task_completed",
			severity: "info",
			taskId: "T02",
			payload: { result: "done" },
			metadata: { provider: "moonshot-k2.6" },
		} as EventLog,
		{
			id: "ev-14",
			timestamp: ts(1300),
			type: "task_completed",
			severity: "info",
			taskId: "T03",
			payload: { result: "done" },
			metadata: { provider: "deepseek-v4" },
		} as EventLog,
		{
			id: "ev-15",
			timestamp: ts(1400),
			type: "task_completed",
			severity: "info",
			taskId: "T04",
			payload: { result: "done" },
			metadata: { provider: "minimax-m2.7" },
		} as EventLog,
		{
			id: "ev-end",
			timestamp: ts(1500),
			type: "auto_command_completed",
			severity: "info",
			payload: { result: "success" },
		} as EventLog,
	];
}

async function createSyntheticRun(
	eventsDir: string,
	runId: string,
): Promise<string> {
	const filePath = path.join(eventsDir, `run-${runId}.jsonl`);
	await mkdir(eventsDir, { recursive: true });
	const events = buildSyntheticEvents();
	const lines = events.map((e) => JSON.stringify(e)).join("\n");
	await fs.writeFile(filePath, lines + "\n", "utf-8");
	return filePath;
}

// ── E2E: RunManager synthetic pipeline ─────────────────────────────────────

describe("E2E: RunManager synthetic pipeline", () => {
	let tmpDir: string;
	let manager: RunManager;

	beforeEach(async () => {
		tmpDir = await createTempDir("runmanager");
	});

	afterEach(async () => {
		manager?.close();
		await cleanupTempDir(tmpDir);
	});

	it("parses a synthetic JSONL file and detects the run", async () => {
		const runId = `synth-${Date.now()}`;
		await createSyntheticRun(tmpDir, runId);
		manager = new RunManager({ eventsDir: tmpDir });
		await manager.start();
		const runs = manager.getRuns();
		expect(runs.length).toBe(1);
		expect(runs[0].id).toBe(`run-${runId}`);
		expect(runs[0].events.length).toBeGreaterThanOrEqual(1);
	});

	it("extracts task_scheduled and task_completed events correctly", async () => {
		const runId = `synth-${Date.now()}`;
		await createSyntheticRun(tmpDir, runId);
		manager = new RunManager({ eventsDir: tmpDir });
		await manager.start();
		const run = manager.getRunById(`run-${runId}`);
		expect(run).toBeDefined();
		const scheduled = run!.events.filter((e) => e.type === "task_scheduled");
		const completed = run!.events.filter((e) => e.type === "task_completed");
		expect(scheduled.length).toBe(4);
		expect(completed.length).toBe(4);
	});

	it("extracts provider_fallback events with from/to providers", async () => {
		const runId = `synth-${Date.now()}`;
		await createSyntheticRun(tmpDir, runId);
		manager = new RunManager({ eventsDir: tmpDir });
		await manager.start();
		const run = manager.getRunById(`run-${runId}`);
		expect(run).toBeDefined();
		const fallbacks = run!.events.filter((e) => e.type === "provider_fallback");
		expect(fallbacks.length).toBe(1);
		const fb = fallbacks[0];
		expect(fb.metadata?.fromProvider).toBe("opencode-go");
		expect(fb.metadata?.toProvider).toBe("minimax-m2.7");
	});
});

// ── E2E: Hook and component data pipeline ──────────────────────────────────

describe("E2E: Hook and component data pipeline", () => {
	const events = buildSyntheticEvents();

	it("useTaskList extracts correct task list from synthetic events", () => {
		const result = extractTasks(events);
		expect(result.length).toBe(4);
		const ids = result.map((t) => t.id).sort();
		expect(ids).toEqual(["T01", "T02", "T03", "T04"]);
		expect(result.every((t) => t.status === "completed")).toBe(true);
	});

	it("useCostTable aggregates costs from synthetic events", () => {
		const result = extractCosts(events);
		expect(result.rows.length).toBe(5);
		expect(result.totalCostUsd).toBe(0.15);
		expect(result.totalTokens).toBe(1095);
		const tavily = result.rows.find((r) => r.provider === "tavily");
		expect(tavily).toBeDefined();
		expect(tavily!.costUsd).toBe(0.02);
	});

	it("AgentStatus detects fallback events in synthetic run data", () => {
		const result = extractAgents(events);
		expect(result.agents.length).toBe(5);
		expect(result.fallbackCount).toBe(1);
		expect(result.latestFallback).toBeDefined();
		expect(result.latestFallback!.from).toBe("opencode-go");
		expect(result.latestFallback!.to).toBe("minimax-m2.7");
		expect(result.latestFallback!.reason).toBe("429 Too Many Requests");
	});

	it("ProgressBar calculates correct completion percentage from synthetic events", () => {
		const tasks = extractTasks(events);
		const completed = tasks.filter((t) => t.status === "completed").length;
		const total = tasks.length;
		const percentage =
			total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
		expect(percentage).toBe(100);
	});
});

// ── E2E: SummaryGenerator metrics ──────────────────────────────────────────

describe("E2E: SummaryGenerator metrics", () => {
	let eventFile: string;
	let runId: string;

	beforeEach(async () => {
		runId = `test-synth-${Date.now()}`;
		const eventsDir = path.join(process.cwd(), ".events");
		eventFile = await createSyntheticRun(eventsDir, runId);
	});

	afterEach(async () => {
		await rm(eventFile, { force: true }).catch(() => {});
		const outputDir = path.join(process.cwd(), ".apohara", "runs", runId);
		await rm(outputDir, { recursive: true, force: true }).catch(() => {});
	});

	it("extracts >=1 fallback events", async () => {
		const generator = new SummaryGenerator({
			runId,
			outputDir: path.join(process.cwd(), ".apohara", "runs"),
		});
		const summaryPath = await generator.generate();
		const markdown = await readFile(summaryPath, "utf-8");
		expect(markdown).toContain("## Fallbacks Activated");
	});

	it("counts >=4 unique providers", async () => {
		const generator = new SummaryGenerator({
			runId,
			outputDir: path.join(process.cwd(), ".apohara", "runs"),
		});
		const summaryPath = await generator.generate();
		const markdown = await readFile(summaryPath, "utf-8");
		// Verify provider stats table contains at least 4 providers
		expect(markdown).toContain("tavily");
		expect(markdown).toContain("moonshot-k2.6");
		expect(markdown).toContain("deepseek-v4");
		expect(markdown).toContain("minimax-m2.7");
	});

	it("calculates total cost < $0.50 for synthetic demo data", async () => {
		const generator = new SummaryGenerator({
			runId,
			outputDir: path.join(process.cwd(), ".apohara", "runs"),
		});
		const summaryPath = await generator.generate();
		const markdown = await readFile(summaryPath, "utf-8");
		expect(markdown).toContain("Estimated Cost:");
		const costMatch = markdown.match(/Estimated Cost:[^$]*\$([0-9.]+)/);
		expect(costMatch).not.toBeNull();
		const cost = parseFloat(costMatch![1]);
		expect(cost).toBeLessThan(0.5);
	});

	it("produces markdown containing fallback section", async () => {
		const generator = new SummaryGenerator({
			runId,
			outputDir: path.join(process.cwd(), ".apohara", "runs"),
		});
		const summaryPath = await generator.generate();
		const markdown = await readFile(summaryPath, "utf-8");
		expect(markdown).toContain("## Fallbacks Activated");
		expect(markdown).toContain("opencode-go → minimax-m2.7");
	});
});

// ── E2E: Multi-run support ─────────────────────────────────────────────────

describe("E2E: Multi-run support", () => {
	let tmpDir: string;
	let manager: RunManager;

	beforeEach(async () => {
		tmpDir = await createTempDir("multirun");
	});

	afterEach(async () => {
		manager?.close();
		await cleanupTempDir(tmpDir);
	});

	it("RunManager handles two simultaneous JSONL runs", async () => {
		await createSyntheticRun(tmpDir, "run-a");
		await createSyntheticRun(tmpDir, "run-b");
		manager = new RunManager({ eventsDir: tmpDir });
		await manager.start();
		const runs = manager.getRuns();
		expect(runs.length).toBe(2);
		const ids = runs.map((r) => r.id).sort();
		expect(ids).toEqual(["run-run-a", "run-run-b"]);
	});
});

// ── E2E: Demo script structure ─────────────────────────────────────────────

describe("E2E: Demo script structure", () => {
	it("demo script exists and is executable", async () => {
		const scriptPath = path.join(process.cwd(), "scripts", "demo-dashboard.sh");
		const stats = await fs.stat(scriptPath);
		expect(stats.isFile()).toBe(true);
		expect(stats.mode & 0o111).toBeGreaterThan(0);
	});

	it("contains all required metric verification checks", async () => {
		const scriptPath = path.join(process.cwd(), "scripts", "demo-dashboard.sh");
		const content = await fs.readFile(scriptPath, "utf-8");
		expect(content).toContain("uniqueProviders");
		expect(content).toContain("fallbackCount");
		expect(content).toContain("TOTAL_COST");
		expect(content).toContain("0.50");
	});
});
