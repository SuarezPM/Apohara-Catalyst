/**
 * G5.F.10 — compactLedger auto-invoke in consume().
 *
 * Wave-1 reviewer follow-up on T4.2. Without auto-compaction the JSONL
 * ledger keeps every consumed entry, and a restart re-resurrects them
 * as pending — the user sees the same "Allow X?" prompt a second time
 * even after they had approved it.
 *
 * After G5.F.10, a successful consume triggers an async compaction so
 * the on-disk ledger reflects only live state.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurablePromptStore } from "../../../src/core/safety/durablePrompt";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "apohara-compact-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("consume() auto-compacts so consumed entries drop from the on-disk ledger", async () => {
	const ledger = join(dir, "prompts.jsonl");
	const store = new DurablePromptStore({ ledgerPath: ledger });

	store.enqueueRequest({
		request_id: "req-consumed",
		inv: { tool: "Bash", input: { command: "ls" } },
		suggested_pattern: "Bash(ls)",
		available_scopes: ["once", "session"],
		created_at: 1000,
	});
	store.setResponse({ request_id: "req-consumed", decision: "allow", scope: "session" });

	// Drain the prompt — this triggers consume() which schedules compact.
	const resp = await store.waitForResponse("req-consumed", 1000, 10);
	expect(resp?.decision).toBe("allow");

	// Allow async best-effort compact to flush.
	await new Promise((r) => setTimeout(r, 60));

	// A fresh store re-loaded from the same path MUST NOT see the
	// consumed entry as pending.
	const fresh = new DurablePromptStore({ ledgerPath: ledger });
	await fresh.load();
	expect(fresh.isPending("req-consumed")).toBe(false);

	const raw = await readFile(ledger, "utf-8");
	expect(raw).not.toContain("req-consumed");
});

test("consume() also drops the consumed prompt for un-pending fresh stores", async () => {
	// Variant where the request is added, response set, then consumed,
	// AND a second unrelated request is left pending. The second
	// request MUST survive the compaction.
	const ledger = join(dir, "prompts.jsonl");
	const store = new DurablePromptStore({ ledgerPath: ledger });

	store.enqueueRequest({
		request_id: "req-keep",
		inv: { tool: "Bash", input: { command: "ps" } },
		suggested_pattern: "Bash(ps)",
		available_scopes: ["once"],
		created_at: 1001,
	});
	store.enqueueRequest({
		request_id: "req-drop",
		inv: { tool: "Bash", input: { command: "ls" } },
		suggested_pattern: "Bash(ls)",
		available_scopes: ["once"],
		created_at: 1002,
	});
	store.setResponse({ request_id: "req-drop", decision: "deny" });
	await store.waitForResponse("req-drop", 1000, 10);

	await new Promise((r) => setTimeout(r, 60));

	const fresh = new DurablePromptStore({ ledgerPath: ledger });
	await fresh.load();
	expect(fresh.isPending("req-drop")).toBe(false);
	expect(fresh.isPending("req-keep")).toBe(true);
});
