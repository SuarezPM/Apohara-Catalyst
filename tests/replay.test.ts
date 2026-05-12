import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildPlan,
	planToDeterministicJSON,
	resolveRunPath,
} from "../src/commands/replay";
import { EventLedger } from "../src/core/ledger";
import { ProviderRouter } from "../src/providers/router";

describe("replay command — buildPlan / dry-run JSON (Phase 4.4 + 4.5)", () => {
	let dir: string;
	let filePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-replay-"));
		filePath = join(dir, "run-replay.jsonl");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("extracts llm_request events from a chained ledger", async () => {
		const ledger = new EventLedger("replay-run", { filePath });
		await ledger.log("llm_request", {
			provider: "anthropic-api",
			model: "claude-sonnet-4-20250514",
			messages: [
				{ role: "system", content: "be terse" },
				{ role: "user", content: "hi" },
			],
		});
		await ledger.log("task_completed", { id: "t1" });
		await ledger.log("llm_request", {
			provider: "openai",
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: "ping" }],
		});

		const plan = await buildPlan(filePath);
		expect(plan.runId).toBe("replay-run");
		expect(plan.ledgerVersion).toBe(1);
		expect(plan.llmRequests.length).toBe(2);
		expect(plan.llmRequests[0].provider).toBe("anthropic-api");
		expect(plan.llmRequests[0].messages).toEqual([
			{ role: "system", content: "be terse" },
			{ role: "user", content: "hi" },
		]);
		expect(plan.llmRequests[1].provider).toBe("openai");
		expect(plan.totalEvents).toBe(4); // genesis + 3 events
	});

	it("produces deterministic JSON across invocations for --dry-run", async () => {
		const ledger = new EventLedger("dry-test", { filePath });
		await ledger.log("llm_request", {
			provider: "anthropic-api",
			model: "claude-sonnet-4-20250514",
			messages: [{ role: "user", content: "deterministic?" }],
		});

		const plan1 = await buildPlan(filePath);
		const plan2 = await buildPlan(filePath);
		const json1 = planToDeterministicJSON(plan1);
		const json2 = planToDeterministicJSON(plan2);
		expect(json1).toBe(json2);

		// Keys must be alphabetically ordered at top level
		const parsed = JSON.parse(json1);
		const keys = Object.keys(parsed);
		const sorted = [...keys].sort();
		expect(keys).toEqual(sorted);
	});

	it("resolveRunPath: bare runId resolves to .events/run-<id>.jsonl", () => {
		const resolved = resolveRunPath("2026-05-11T22-30-47-262Z");
		expect(
			resolved.endsWith("/.events/run-2026-05-11T22-30-47-262Z.jsonl"),
		).toBe(true);
	});

	it("resolveRunPath: path-like input passes through", () => {
		const resolved = resolveRunPath("/tmp/custom-ledger.jsonl");
		expect(resolved).toBe("/tmp/custom-ledger.jsonl");
	});

	it("buildPlan handles ledger with no llm_request events", async () => {
		const ledger = new EventLedger("no-llm", { filePath });
		await ledger.log("task_scheduled", { id: "t1" });
		await ledger.log("worktree_created", { path: "/tmp/x" });

		const plan = await buildPlan(filePath);
		expect(plan.llmRequests.length).toBe(0);
		expect(plan.totalEvents).toBe(3);
	});
});

describe("ProviderRouter replayMode — temperature:0 injection (Phase 4.4)", () => {
	let originalFetch: typeof globalThis.fetch;
	let capturedBody: string | null;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		capturedBody = null;
		globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
			capturedBody = (init?.body as string) ?? null;
			return new Response(
				JSON.stringify({
					content: [{ type: "text", text: "replayed" }],
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("injects temperature:0 into the request body when replayMode is true", async () => {
		const router = new ProviderRouter({
			opencodeApiKey: "oc-test-key",
			replayMode: true,
		});
		await router.completion({
			messages: [{ role: "user", content: "test" }],
			provider: "opencode-go",
		});

		expect(capturedBody).not.toBeNull();
		const body = JSON.parse(capturedBody as string);
		expect(body.temperature).toBe(0);
	});

	it("does NOT inject temperature when replayMode is false", async () => {
		const router = new ProviderRouter({
			opencodeApiKey: "oc-test-key",
			replayMode: false,
		});
		await router.completion({
			messages: [{ role: "user", content: "test" }],
			provider: "opencode-go",
		});

		expect(capturedBody).not.toBeNull();
		const body = JSON.parse(capturedBody as string);
		expect(body.temperature).toBeUndefined();
	});
});

describe("ProviderRouter llm_request logging (Phase 4 prereq)", () => {
	let dir: string;
	let filePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-replay-log-"));
		filePath = join(dir, "run-log.jsonl");

		globalThis.fetch = mock(async () => {
			return new Response(
				JSON.stringify({
					content: [{ type: "text", text: "ok" }],
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
				{ status: 200 },
			);
		}) as unknown as typeof globalThis.fetch;
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("writes llm_request event to the shared ledger before each provider call", async () => {
		const ledger = new EventLedger("log-test", { filePath });
		const router = new ProviderRouter({
			opencodeApiKey: "oc-test-key",
			eventLedger: ledger,
		});

		await router.completion({
			messages: [{ role: "user", content: "hello" }],
			provider: "opencode-go",
		});

		const content = await readFile(filePath, "utf-8");
		const lines = content.split("\n").filter((l) => l.length > 0);
		const llmRequests = lines
			.map((l) => JSON.parse(l))
			.filter((e) => e.type === "llm_request");

		expect(llmRequests.length).toBe(1);
		expect(llmRequests[0].payload.provider).toBe("opencode-go");
		expect(llmRequests[0].payload.messages).toEqual([
			{ role: "user", content: "hello" },
		]);
		expect(typeof llmRequests[0].hash).toBe("string");
	});
});
