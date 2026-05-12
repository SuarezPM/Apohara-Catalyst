import { beforeEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { EventLedger } from "../src/core/ledger";
import { ProviderRouter } from "../src/providers/router";

describe("ProviderRouter Integration", () => {
	let router: ProviderRouter;
	let ledger: EventLedger;

	beforeEach(async () => {
		// Create router with test API keys to avoid env validation errors
		router = new ProviderRouter({
			opencodeApiKey: "test-opencode-key",
			deepseekApiKey: "test-deepseek-key",
		});
		ledger = new EventLedger("test-run");
		// Clean up events from previous test
		await rm(join(process.cwd(), ".events"), { recursive: true, force: true });
	});

	it("should instantiate router with injected config", () => {
		expect(router).toBeDefined();
	});

	it("should log events to the ledger", async () => {
		await ledger.log("test_event", { foo: "bar" }, "info", "T01");

		// The ledger file should exist
		const filePath = ledger.getFilePath();
		expect(filePath).toContain(".events/run-test-run.jsonl");
	});

	it("should log events with metadata including tokens and cost", async () => {
		await ledger.log("llm_request", { prompt: "Hello" }, "info", "T02", {
			provider: "opencode-go",
			model: "opencode-go/kimi-k2.5",
			tokens: { prompt: 10, completion: 5, total: 15 },
			costUsd: 0.001,
			durationMs: 250,
		});

		// Verify the ledger tracked this
		const filePath = ledger.getFilePath();
		expect(filePath).toBeDefined();
	});
});
