/**
 * G5.A.1 — persistent stdin per nimbalyst #1.1.
 *
 * Contract: AgentProtocol exposes `appendToStdin(sessionId, data)` and the
 * stdin handle stays OPEN across multiple appends until `endStdin(sessionId)`
 * or `abortSession(sessionId)` is called. This is the foundation for
 * G5.A.6 (multi-turn) — we can keep adding turns without re-spawning.
 */
import { test, expect } from "bun:test";
import { CodexProtocol } from "../../../../src/core/providers/protocols/CodexProtocol";
import { ClaudeCodeProtocol } from "../../../../src/core/providers/protocols/ClaudeCodeProtocol";
import { OpenCodeProtocol } from "../../../../src/core/providers/protocols/OpenCodeProtocol";

function isMissingBinary(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { message?: string };
  if (e?.code === "ENOENT") return true;
  const msg = e?.message ?? "";
  return msg.includes("ENOENT") || msg.includes("not found");
}

test("CodexProtocol.appendToStdin keeps stdin OPEN across appends", async () => {
  const p = new CodexProtocol();
  let session;
  try {
    session = await p.createSession({ workspacePath: "/tmp" });
  } catch (err) {
    if (isMissingBinary(err)) {
      console.warn("codex binary not in PATH, skipping");
      return;
    }
    throw err;
  }

  // First append should not error
  await p.appendToStdin(session.providerId, "first-turn\n");
  // Second append should also succeed (stdin still open).
  await p.appendToStdin(session.providerId, "second-turn\n");

  // Explicit end-of-stdin closes the handle.
  await p.endStdin(session.providerId);
  await p.abortSession(session.providerId);
});

test("ClaudeCodeProtocol.appendToStdin is callable on the contract", async () => {
  const p = new ClaudeCodeProtocol();
  // Contract is the same shape — even if the binary is missing the method
  // throwing 'no session' is the expected fast-path.
  await expect(p.appendToStdin("missing-session", "x")).rejects.toThrow();
});

test("OpenCodeProtocol.appendToStdin is callable on the contract", async () => {
  const p = new OpenCodeProtocol();
  await expect(p.appendToStdin("missing-session", "x")).rejects.toThrow();
});

test("appendToStdin on unknown session rejects with 'no session'", async () => {
  const p = new CodexProtocol();
  await expect(p.appendToStdin("no-such-session", "data")).rejects.toThrow(
    /no session/i,
  );
});
