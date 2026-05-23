/**
 * Unit tests for `apohara worker` subcommand wiring (G6.C.3).
 *
 * The command itself does NOT yet connect to the SSH server (handshake +
 * dispatch land in later sub-tasks); these tests pin the CLI surface and the
 * feature-flag gating only.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  parseWorkerArgs,
  runWorkerCommand,
  type WorkerCommandResult,
} from "./worker";

describe("apohara worker — arg parsing", () => {
  it("--help short-circuits with usage text", () => {
    const r = parseWorkerArgs(["--help"]);
    expect(r.help).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it("defaults endpoint to ~/.apohara/ssh-server/endpoint.json", () => {
    const r = parseWorkerArgs([]);
    expect(r.endpointPath?.endsWith(".apohara/ssh-server/endpoint.json")).toBe(true);
  });

  it("--endpoint <path> overrides discovery", () => {
    const r = parseWorkerArgs(["--endpoint", "/tmp/ep.json"]);
    expect(r.endpointPath).toBe("/tmp/ep.json");
  });

  it("--key <path> threads through", () => {
    const r = parseWorkerArgs(["--key", "/tmp/id_ed25519"]);
    expect(r.keyPath).toBe("/tmp/id_ed25519");
  });

  it("--max-tasks 4 parses into number", () => {
    const r = parseWorkerArgs(["--max-tasks", "4"]);
    expect(r.maxConcurrentTasks).toBe(4);
  });

  it("--max-tasks abc returns an error", () => {
    const r = parseWorkerArgs(["--max-tasks", "abc"]);
    expect(r.error?.code).toBe("INVALID_MAX_TASKS");
  });

  it("unknown flag is reported", () => {
    const r = parseWorkerArgs(["--launch-missiles"]);
    expect(r.error?.code).toBe("UNKNOWN_FLAG");
  });
});

describe("apohara worker — feature flag", () => {
  const originalFlag = process.env.APOHARA_REMOTE_WORKERS;

  beforeEach(() => {
    delete process.env.APOHARA_REMOTE_WORKERS;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.APOHARA_REMOTE_WORKERS;
    } else {
      process.env.APOHARA_REMOTE_WORKERS = originalFlag;
    }
  });

  it("returns FEATURE_DISABLED when flag is off", async () => {
    const r: WorkerCommandResult = await runWorkerCommand({
      args: [],
      env: {},
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.error?.code).toBe("FEATURE_DISABLED");
  });

  it("does NOT activate when flag is 0", async () => {
    const r = await runWorkerCommand({
      args: [],
      env: { APOHARA_REMOTE_WORKERS: "0" },
    });
    expect(r.error?.code).toBe("FEATURE_DISABLED");
  });

  it("does NOT activate when flag is empty", async () => {
    const r = await runWorkerCommand({
      args: [],
      env: { APOHARA_REMOTE_WORKERS: "" },
    });
    expect(r.error?.code).toBe("FEATURE_DISABLED");
  });

  it("--help works regardless of feature flag", async () => {
    const r = await runWorkerCommand({
      args: ["--help"],
      env: {},
    });
    expect(r.exitCode).toBe(0);
    expect(r.help).toBe(true);
  });

  it("with flag on but no endpoint file → ENDPOINT_NOT_FOUND", async () => {
    const r = await runWorkerCommand({
      args: ["--endpoint", "/tmp/does-not-exist-apohara-worker-test.json"],
      env: { APOHARA_REMOTE_WORKERS: "1" },
    });
    expect(r.error?.code).toBe("ENDPOINT_NOT_FOUND");
  });
});
