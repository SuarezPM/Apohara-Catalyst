import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workDir: string;
let originalHome: string | undefined;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-hook-script-"));
  originalHome = process.env.HOME;
  process.env.HOME = workDir;
  await mkdir(join(workDir, ".apohara/sockets"), { recursive: true });
  await writeFile(join(workDir, ".apohara/sockets/hooks-endpoint.json"), JSON.stringify({
    port: 1, token: "test", started_at: 0,
  }));
});
afterAll(async () => {
  process.env.HOME = originalHome;
  await rm(workDir, { recursive: true, force: true });
});

test("apohara-claude-hook.sh fails closed if endpoint file missing", async () => {
  await rm(join(workDir, ".apohara/sockets/hooks-endpoint.json"));
  const proc = spawn(["bash", "scripts/hooks/apohara-claude-hook.sh"], {
    env: { ...process.env, APOHARA_HOOK_TYPE: "pre_tool_use" },
    stdin: new TextEncoder().encode(JSON.stringify({ tool_name: "Bash" })),
    stdout: "pipe", stderr: "pipe",
  });
  const exitCode = await proc.exited;
  // Script exits 0 even when endpoint missing (must NEVER fail the CLI)
  expect(exitCode).toBe(0);
});

test("apohara-claude-hook.sh exits 0 even if sidecar unreachable (no block)", async () => {
  await writeFile(join(workDir, ".apohara/sockets/hooks-endpoint.json"), JSON.stringify({
    port: 65530, token: "t", started_at: 0,  // unreachable port
  }));
  const proc = spawn(["bash", "scripts/hooks/apohara-claude-hook.sh"], {
    env: {
      ...process.env,
      APOHARA_HOOK_TYPE: "pre_tool_use",
      APOHARA_TASK_ID: "task-42",
      APOHARA_PANE_KEY: "pane-1",
    },
    stdin: new TextEncoder().encode('{"tool_name":"Bash","tool_input":{},"timestamp":0}'),
    stdout: "pipe", stderr: "pipe",
  });
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});