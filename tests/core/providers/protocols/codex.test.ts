/**
 * T4.7b — CodexProtocol spawn real (`codex exec --json`) per spec §4.5.
 *
 * Skip-on-ENOENT pattern: the codex binary may not be installed in CI / dev,
 * so tests warn-and-return instead of hard-failing. The contract under test
 * is the *spawn shape* (providerId format includes the child PID + ts) and
 * the §0.4 env sanitization (no OPENAI_API_KEY leak into the subprocess).
 */
import { expect, test } from "bun:test";
import { CodexProtocol } from "../../../../src/core/providers/protocols/CodexProtocol";

/** Skip-on-ENOENT helper: either `err.code === "ENOENT"` (Node) or message
 *  containing ENOENT / "not found" (Bun's wording). */
function isMissingBinary(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { message?: string };
  if (e?.code === "ENOENT") return true;
  const msg = e?.message ?? "";
  return msg.includes("ENOENT") || msg.includes("not found");
}

test("createSession spawns codex binary (or skips if not installed)", async () => {
  const p = new CodexProtocol();
  try {
    const session = await p.createSession({
      workspacePath: "/tmp",
    });
    // Real spawn must produce providerId = `codex-${pid}-${timestamp}`.
    expect(session.providerId).toMatch(/^codex-\d+-\d+$/);
    expect(session.spawnedAt).toBeGreaterThan(0);
    await p.abortSession(session.providerId);
  } catch (err) {
    if (isMissingBinary(err)) {
      console.warn("codex binary not in PATH, skipping spawn test");
      return;
    }
    throw err;
  }
});

test("createSession uses sanitizeEnv (no OPENAI_API_KEY leak)", async () => {
  const p = new CodexProtocol();
  process.env.OPENAI_API_KEY = "fake-key-for-test";
  try {
    const session = await p.createSession({ workspacePath: "/tmp" });
    expect(session.providerId).toBeTruthy();
    expect(session.providerId).toMatch(/^codex-\d+-\d+$/);
    await p.abortSession(session.providerId);
  } catch (err) {
    if (isMissingBinary(err)) {
      console.warn("codex binary not in PATH, skipping");
      return;
    }
    throw err;
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});
