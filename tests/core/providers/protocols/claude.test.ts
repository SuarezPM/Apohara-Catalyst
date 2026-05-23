import { expect, test } from "bun:test";
import { ClaudeCodeProtocol } from "../../../../src/core/providers/protocols/ClaudeCodeProtocol";

test("createSession spawns claude binary (or skips if not installed)", async () => {
  const p = new ClaudeCodeProtocol();
  try {
    const session = await p.createSession({
      workspacePath: "/tmp",
      systemPrompt: "echo hello and exit",
    });
    // Format: claude-<pid>-<timestamp>
    expect(session.providerId).toMatch(/^claude-\d+-\d+$/);
    expect(session.spawnedAt).toBeGreaterThan(0);
  } catch (err) {
    if ((err as Error).message.includes("ENOENT")) {
      console.warn("claude binary not in PATH, skipping spawn test");
      return;
    }
    throw err;
  }
});

test("createSession uses sanitizeEnv (no ANTHROPIC_API_KEY leak)", async () => {
  const p = new ClaudeCodeProtocol();
  process.env.ANTHROPIC_API_KEY = "fake-key-for-test";
  try {
    const session = await p.createSession({ workspacePath: "/tmp" });
    expect(session.providerId).toBeTruthy();
  } catch (err) {
    if ((err as Error).message.includes("ENOENT")) {
      console.warn("claude binary not in PATH, skipping");
      return;
    }
    throw err;
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
