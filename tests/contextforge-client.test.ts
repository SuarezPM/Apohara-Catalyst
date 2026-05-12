/**
 * Unit tests for the ContextForge HTTP client (M015.2).
 *
 * Covers: env-var contract, register happy path, optimize happy path with
 * savings, graceful fallback on HTTP 503, graceful fallback on timeout,
 * and the unavailable-event dedup window. Schema fidelity asserted
 * against `apohara_context_forge/models.py:33-95`.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ContextForgeClient } from "../src/core/contextforge-client";

/** Minimal stub of EventLedger.log so we can assert event emissions. */
function makeStubLedger(): {
	log: ReturnType<typeof mock>;
	events: Array<{ type: string; payload: any; severity?: string }>;
} {
	const events: Array<{ type: string; payload: any; severity?: string }> = [];
	const log = mock(async (type: string, payload: any, severity?: string) => {
		events.push({ type, payload, severity });
	});
	return { log, events };
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENABLED = process.env.CONTEXTFORGE_ENABLED;
const ORIGINAL_BASEURL = process.env.CONTEXTFORGE_BASE_URL;
const ORIGINAL_TIMEOUT = process.env.CONTEXTFORGE_TIMEOUT_MS;

beforeEach(() => {
	process.env.CONTEXTFORGE_ENABLED = "1";
	process.env.CONTEXTFORGE_BASE_URL = "http://localhost:8001";
	process.env.CONTEXTFORGE_TIMEOUT_MS = "500"; // Keep tests fast
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	if (ORIGINAL_ENABLED === undefined) {
		delete process.env.CONTEXTFORGE_ENABLED;
	} else {
		process.env.CONTEXTFORGE_ENABLED = ORIGINAL_ENABLED;
	}
	if (ORIGINAL_BASEURL === undefined) {
		delete process.env.CONTEXTFORGE_BASE_URL;
	} else {
		process.env.CONTEXTFORGE_BASE_URL = ORIGINAL_BASEURL;
	}
	if (ORIGINAL_TIMEOUT === undefined) {
		delete process.env.CONTEXTFORGE_TIMEOUT_MS;
	} else {
		process.env.CONTEXTFORGE_TIMEOUT_MS = ORIGINAL_TIMEOUT;
	}
});

describe("ContextForgeClient.fromEnv — opt-in contract", () => {
	test("returns null when CONTEXTFORGE_ENABLED is undefined", () => {
		delete process.env.CONTEXTFORGE_ENABLED;
		expect(ContextForgeClient.fromEnv()).toBeNull();
	});

	test("returns null when CONTEXTFORGE_ENABLED is '0'", () => {
		process.env.CONTEXTFORGE_ENABLED = "0";
		expect(ContextForgeClient.fromEnv()).toBeNull();
	});

	test("returns a client when CONTEXTFORGE_ENABLED is '1', uses env baseUrl", () => {
		process.env.CONTEXTFORGE_BASE_URL = "http://elsewhere:9001/";
		const c = ContextForgeClient.fromEnv();
		expect(c).not.toBeNull();
		// Trailing slash is stripped
		expect(c!.baseUrl).toBe("http://elsewhere:9001");
	});

	test("default timeout 3000ms when env not set", () => {
		delete process.env.CONTEXTFORGE_TIMEOUT_MS;
		const c = ContextForgeClient.fromEnv();
		expect(c!.timeoutMs).toBe(3000);
	});
});

describe("ContextForgeClient.register — POST /tools/register_context", () => {
	test("sends agent_id + context body and returns ContextEntry fields", async () => {
		let capturedUrl: string | undefined;
		let capturedBody: any;
		globalThis.fetch = mock(async (url: any, init: any) => {
			capturedUrl = String(url);
			capturedBody = JSON.parse(init.body);
			return new Response(
				JSON.stringify({
					agent_id: "task-7",
					context: "raw",
					token_count: 42,
					compressed_token_count: 12,
					ttl_seconds: 300,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as any;

		const { log } = makeStubLedger();
		const c = ContextForgeClient.fromEnv({ log } as any)!;
		const result = await c.register("task-7", "raw");

		expect(capturedUrl).toBe("http://localhost:8001/tools/register_context");
		// Strict body — only agent_id + context, NO extras (server has extra="forbid")
		expect(Object.keys(capturedBody).sort()).toEqual(["agent_id", "context"]);
		expect(capturedBody.agent_id).toBe("task-7");
		expect(capturedBody.context).toBe("raw");
		expect(result?.agent_id).toBe("task-7");
		expect(result?.token_count).toBe(42);
		expect(log).toHaveBeenCalled();
	});
});

describe("ContextForgeClient.optimize — POST /tools/get_optimized_context", () => {
	test("happy path with savings: returns final_context + tokens_saved", async () => {
		globalThis.fetch = mock(async () => {
			return new Response(
				JSON.stringify({
					strategy: "compress",
					shared_prefix: null,
					compressed_context: "shorter version",
					final_context: "shorter version",
					original_tokens: 1000,
					final_tokens: 400,
					tokens_saved: 600,
					savings_pct: 60.0,
					rationale: "llmlingua compression",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as any;

		const { log, events } = makeStubLedger();
		const c = ContextForgeClient.fromEnv({ log } as any)!;
		const r = await c.optimize("task-7", "long original context here ...");

		expect(r).not.toBeNull();
		expect(r!.final_context).toBe("shorter version");
		expect(r!.tokens_saved).toBe(600);
		expect(r!.savings_pct).toBe(60);
		expect(r!.strategy).toBe("compress");

		// Ledger sees a contextforge_optimized event with the savings payload
		const optEvt = events.find((e) => e.type === "contextforge_optimized");
		expect(optEvt).toBeDefined();
		expect(optEvt!.payload.tokens_saved).toBe(600);
	});

	test("graceful fallback on HTTP 503: returns null, emits unavailable, no throw", async () => {
		globalThis.fetch = mock(async () => {
			return new Response('{"detail":"passthrough"}', { status: 503 });
		}) as any;

		const { log, events } = makeStubLedger();
		const c = ContextForgeClient.fromEnv({ log } as any)!;
		const r = await c.optimize("task-x", "ctx");

		expect(r).toBeNull();
		const evt = events.find((e) => e.type === "contextforge_unavailable");
		expect(evt).toBeDefined();
		expect(evt!.payload.reason).toBe("http_503");
		expect(evt!.severity).toBe("warning");
	});

	test("graceful fallback on timeout: returns null, emits unavailable with reason='timeout'", async () => {
		// Force an immediate AbortError before we even reach the network.
		globalThis.fetch = mock(async () => {
			const err = new Error("aborted");
			err.name = "AbortError";
			throw err;
		}) as any;

		const { log, events } = makeStubLedger();
		const c = ContextForgeClient.fromEnv({ log } as any)!;
		const r = await c.optimize("task-x", "ctx");

		expect(r).toBeNull();
		const evt = events.find((e) => e.type === "contextforge_unavailable");
		expect(evt).toBeDefined();
		expect(evt!.payload.reason).toBe("timeout");
	});

	test("unavailable event is deduped within 60s window", async () => {
		globalThis.fetch = mock(async () => {
			return new Response("Bad Gateway", { status: 502 });
		}) as any;

		const { log, events } = makeStubLedger();
		const c = ContextForgeClient.fromEnv({ log } as any)!;
		// Three consecutive failures back-to-back
		await c.optimize("a", "ctx");
		await c.optimize("a", "ctx");
		await c.optimize("a", "ctx");

		const unavailable = events.filter(
			(e) => e.type === "contextforge_unavailable",
		);
		// Only one log line — the rest are deduped
		expect(unavailable.length).toBe(1);
	});

	test("graceful fallback on JSON parse error", async () => {
		globalThis.fetch = mock(async () => {
			return new Response("not json {", {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as any;

		const { log, events } = makeStubLedger();
		const c = ContextForgeClient.fromEnv({ log } as any)!;
		const r = await c.optimize("a", "ctx");

		expect(r).toBeNull();
		const evt = events.find((e) => e.type === "contextforge_unavailable");
		expect(evt!.payload.reason).toBe("parse");
	});
});

describe("ContextForgeClient.health", () => {
	test("returns true on 200", async () => {
		globalThis.fetch = mock(
			async () => new Response('{"status":"ok"}', { status: 200 }),
		) as any;
		const c = ContextForgeClient.fromEnv()!;
		expect(await c.health()).toBe(true);
	});

	test("returns false on network error (never throws)", async () => {
		globalThis.fetch = mock(async () => {
			throw new Error("ECONNREFUSED");
		}) as any;
		const c = ContextForgeClient.fromEnv()!;
		expect(await c.health()).toBe(false);
	});
});
