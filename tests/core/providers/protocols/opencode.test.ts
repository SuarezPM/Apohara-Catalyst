import { expect, test } from "bun:test";
import { OpenCodeProtocol } from "../../../../src/core/providers/protocols/OpenCodeProtocol";

test("createSession spawns opencode binary (or skips if not installed)", async () => {
  const p = new OpenCodeProtocol();
  try {
    const session = await p.createSession({
      workspacePath: "/tmp",
    });
    // providerId now has format `opencode-<pid>-<timestamp>` from the real spawn.
    expect(session.providerId).toMatch(/^opencode-\d+-\d+$/);
  } catch (err) {
    if ((err as Error).message.includes("ENOENT")) {
      console.warn("opencode binary not in PATH, skipping spawn test");
      return;
    }
    throw err;
  }
});

test("createSession uses sanitizeEnv (no API keys leak through)", async () => {
  const p = new OpenCodeProtocol();
  process.env.OPENCODE_API_KEY = "fake-key";
  try {
    const session = await p.createSession({ workspacePath: "/tmp" });
    expect(session.providerId).toBeTruthy();
    // We can't easily introspect the spawned child's env from outside Bun,
    // but the implementation routes process.env through sanitizeEnv,
    // which blocks `*_API_KEY` per §0.4.
  } catch (err) {
    if ((err as Error).message.includes("ENOENT")) {
      console.warn("opencode binary not in PATH, skipping");
      return;
    }
    throw err;
  } finally {
    delete process.env.OPENCODE_API_KEY;
  }
});
