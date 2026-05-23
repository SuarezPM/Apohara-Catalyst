import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurablePromptStore } from "../../src/core/safety/durablePrompt";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "apohara-prompt-jsonl-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("survives restart: pending request appears after reload", async () => {
  const ledger = join(dir, "prompts.jsonl");
  const store1 = new DurablePromptStore({ ledgerPath: ledger });
  store1.enqueueRequest({
    request_id: "req-1",
    inv: { tool: "Bash", input: { command: "ls" } },
    suggested_pattern: "Bash(ls)",
    available_scopes: ["once", "session"],
    created_at: 1000,
  });

  // Give the best-effort append a tick to flush before the second store reads.
  await new Promise((r) => setTimeout(r, 20));

  const store2 = new DurablePromptStore({ ledgerPath: ledger });
  await store2.load();
  // store2 should know about req-1 from disk, even though it never saw enqueueRequest.
  const resp = await store2.waitForResponse("req-1", 50, 10);
  // No response was set, so we expect null after timeout — but the REQUEST
  // must have been loaded. We assert via "pending" inspection BEFORE the
  // timeout consumes the entry.
  // (waitForResponse drops the pending entry on timeout, so we check
  // isPending against a fresh-loaded store too.)
  const store3 = new DurablePromptStore({ ledgerPath: ledger });
  await store3.load();
  expect(store3.isPending("req-1")).toBe(true);
  expect(resp).toBe(null);
});

test("response set survives restart", async () => {
  const ledger = join(dir, "prompts.jsonl");
  const s1 = new DurablePromptStore({ ledgerPath: ledger });
  s1.enqueueRequest({
    request_id: "req-2",
    inv: { tool: "Bash", input: { command: "rm" } },
    suggested_pattern: "Bash(rm)",
    available_scopes: ["once"],
    created_at: 2000,
  });
  s1.setResponse({ request_id: "req-2", decision: "deny" });

  // Let best-effort appends flush.
  await new Promise((r) => setTimeout(r, 20));

  const s2 = new DurablePromptStore({ ledgerPath: ledger });
  await s2.load();
  const resp = await s2.waitForResponse("req-2", 100, 10);
  expect(resp).not.toBeNull();
  expect(resp!.decision).toBe("deny");
});
