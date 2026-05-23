/**
 * G5.A.6 — multi-turn session via persistent stdin (nimbalyst #1.6).
 *
 * A multi-turn session reuses the same child process: each turn becomes
 * an `appendToStdin(sid, content+"\n")`. The session manager exposes
 * `addTurn(sid, content)` as a high-level wrapper on top of the
 * persistent-stdin contract (G5.A.1).
 */
import { test, expect } from "bun:test";
import { CodexProtocol } from "../../../src/core/providers/protocols/CodexProtocol";
import { SessionTurnManager } from "../../../src/core/providers/session-turns";

function isMissingBinary(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { message?: string };
  if (e?.code === "ENOENT") return true;
  const msg = e?.message ?? "";
  return msg.includes("ENOENT") || msg.includes("not found");
}

test("SessionTurnManager tracks turn count per session", () => {
  const mgr = new SessionTurnManager();
  mgr.recordTurn("sess-a", "first");
  mgr.recordTurn("sess-a", "second");
  mgr.recordTurn("sess-b", "alone");
  expect(mgr.turnCount("sess-a")).toBe(2);
  expect(mgr.turnCount("sess-b")).toBe(1);
  expect(mgr.turnCount("missing")).toBe(0);
});

test("SessionTurnManager.history returns ordered turn contents", () => {
  const mgr = new SessionTurnManager();
  mgr.recordTurn("s", "turn-1");
  mgr.recordTurn("s", "turn-2");
  mgr.recordTurn("s", "turn-3");
  const h = mgr.history("s");
  expect(h.length).toBe(3);
  expect(h[0]?.content).toBe("turn-1");
  expect(h[2]?.content).toBe("turn-3");
  expect(h[0]?.turnIndex).toBe(0);
  expect(h[2]?.turnIndex).toBe(2);
});

test("addTurn delegates to appendToStdin and increments turn counter", async () => {
  const protocol = new CodexProtocol();
  const mgr = new SessionTurnManager();
  let session;
  try {
    session = await protocol.createSession({ workspacePath: "/tmp" });
  } catch (err) {
    if (isMissingBinary(err)) {
      console.warn("codex binary not in PATH, skipping addTurn smoke test");
      return;
    }
    throw err;
  }
  await mgr.addTurn(protocol, session.providerId, "hello-multi-turn");
  await mgr.addTurn(protocol, session.providerId, "second-turn");
  expect(mgr.turnCount(session.providerId)).toBe(2);
  await protocol.abortSession(session.providerId);
});

test("SessionTurnManager.reset clears a session's history", () => {
  const mgr = new SessionTurnManager();
  mgr.recordTurn("s", "abc");
  mgr.reset("s");
  expect(mgr.turnCount("s")).toBe(0);
});
