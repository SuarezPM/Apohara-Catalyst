import { test, expect, beforeEach } from "bun:test";
import { BaseAgentProvider } from "../../../src/core/providers/BaseAgentProvider";
import { resetApoharaDeps, setApoharaDeps } from "../../../src/core/providers/deps";
import type { AgentProtocol, ProtocolEvent } from "../../../src/core/providers/protocols/AgentProtocol";

class FakeProtocol implements AgentProtocol {
  async createSession() { return { providerId: "fake-sid", spawnedAt: Date.now() }; }
  async resumeSession() { return { providerId: "fake-sid", spawnedAt: Date.now() }; }
  async forkSession() { return { providerId: "fake-sid", spawnedAt: Date.now() }; }
  async *sendMessage(): AsyncIterable<ProtocolEvent> {
    yield { kind: "text", content: "hi", turn: 1 };
    yield { kind: "complete", reason: "finished" };
  }
  async abortSession() {}
}

class FakeProvider extends BaseAgentProvider {
  get id() { return "claude-code-cli" as const; }
  get displayName() { return "Fake"; }
  get roles() { return ["coder"] as const; }
  get protocol() { return new FakeProtocol(); }
}

beforeEach(() => {
  resetApoharaDeps();
  setApoharaDeps({
    hookEndpoint: () => ({ port: 8901, token: "t" }),
    indexerSocketPath: "/tmp/idx",
    ledgerPath: "/tmp/l",
    capabilityStatsPath: "/tmp/c",
  });
});

test("spawn returns SpawnedSession", async () => {
  const provider = new FakeProvider();
  const session = await provider.spawn({ workspacePath: "/tmp" });
  expect(session.providerId).toBe("fake-sid");
});

test("spawn injects APOHARA_HOOK_PORT and other env vars", async () => {
  let capturedEnv: Record<string, string> | undefined;
  class CaptureProtocol implements AgentProtocol {
    async createSession(opts: { env?: Record<string, string> }) {
      capturedEnv = opts.env;
      return { providerId: "sid", spawnedAt: 0 };
    }
    async resumeSession() { return { providerId: "sid", spawnedAt: 0 }; }
    async forkSession() { return { providerId: "sid", spawnedAt: 0 }; }
    async *sendMessage(): AsyncIterable<ProtocolEvent> {}
    async abortSession() {}
  }
  class CaptureProvider extends BaseAgentProvider {
    get id() { return "opencode-go" as const; }
    get displayName() { return "Capture"; }
    get roles() { return ["coder"] as const; }
    get protocol() { return new CaptureProtocol(); }
  }
  await new CaptureProvider().spawn({ workspacePath: "/tmp", taskId: "t-42", paneKey: "p-1" });
  expect(capturedEnv?.APOHARA_HOOK_PORT).toBe("8901");
  expect(capturedEnv?.APOHARA_HOOK_TOKEN).toBe("t");
  expect(capturedEnv?.APOHARA_TASK_ID).toBe("t-42");
  expect(capturedEnv?.APOHARA_PANE_KEY).toBe("p-1");
});

test("spawn sanitizes env to remove API keys", async () => {
  let capturedEnv: Record<string, string> | undefined;
  class CaptureProtocol implements AgentProtocol {
    async createSession(opts: { env?: Record<string, string> }) {
      capturedEnv = opts.env;
      return { providerId: "sid", spawnedAt: 0 };
    }
    async resumeSession() { return { providerId: "sid", spawnedAt: 0 }; }
    async forkSession() { return { providerId: "sid", spawnedAt: 0 }; }
    async *sendMessage(): AsyncIterable<ProtocolEvent> {}
    async abortSession() {}
  }
  class CaptureProvider extends BaseAgentProvider {
    get id() { return "opencode-go" as const; }
    get displayName() { return "Capture"; }
    get roles() { return ["coder"] as const; }
    get protocol() { return new CaptureProtocol(); }
  }
  process.env.LEAKED_API_KEY = "should-not-pass";
  await new CaptureProvider().spawn({
    workspacePath: "/tmp",
    env: { ANTHROPIC_API_KEY: "leak", APOHARA_OK: "ok" },
  });
  expect(capturedEnv?.LEAKED_API_KEY).toBeUndefined();
  expect(capturedEnv?.ANTHROPIC_API_KEY).toBeUndefined();
  expect(capturedEnv?.APOHARA_OK).toBe("ok");
  delete process.env.LEAKED_API_KEY;
});
