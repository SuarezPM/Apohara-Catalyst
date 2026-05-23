/**
 * E2E test for G6.C.10 — bring up 3 worker containers, collect a
 * HandshakeRequest line from each, feed it to the host-side
 * handshake_oracle bin, and assert a successful negotiation.
 *
 * Skips cleanly when:
 *   - Docker is not installed
 *   - The Docker daemon is not reachable
 *   - The host-side helper bin `handshake_oracle` is missing
 *   - The env var APOHARA_SKIP_DOCKER_E2E=1 is set
 *
 * Why a stdout-based round trip instead of a real SSH connection?
 * The daemon binary (G6.A) lives in a parallel sprint group and is not yet
 * exposed end-to-end. Until then this test pins the *contract* the SSH
 * channel will carry: identical wire JSON, identical line framing,
 * identical negotiation outcome. When G6.A lands we tighten this to a real
 * SSH dial.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO_ROOT = process.cwd();
const FIXTURE = join(REPO_ROOT, "tests/fixtures/docker-compose.workers.yaml");

const SERVICES = ["worker-1", "worker-2", "worker-3"];

function hasDocker(): boolean {
  if (process.env.APOHARA_SKIP_DOCKER_E2E === "1") return false;
  try {
    const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return r.status === 0 && r.stdout.toString().trim().length > 0;
  } catch {
    return false;
  }
}

function hasComposeV2(): boolean {
  try {
    const r = spawnSync("docker", ["compose", "version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function oraclePath(): string | null {
  // Prefer the workspace target/debug build; CI may pre-build it.
  const candidates = [
    join(REPO_ROOT, "target/debug/handshake_oracle"),
    join(REPO_ROOT, "target/release/handshake_oracle"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const DOCKER_OK = hasDocker() && hasComposeV2();
const ORACLE = oraclePath();
const RUN_IT = DOCKER_OK && ORACLE !== null;

// Use describe.skipIf so the file always loads but the body skips when missing.
const dscribe = RUN_IT ? describe : describe.skip;

dscribe("G6.C.10 — 3 worker containers via docker compose", () => {
  beforeAll(() => {
    // Pre-pull and ensure no stale containers from prior runs.
    spawnSync("docker", ["compose", "-f", FIXTURE, "down", "--remove-orphans", "-t", "1"], {
      stdio: "ignore",
      timeout: 30_000,
    });
  }, 60_000);

  afterAll(() => {
    spawnSync("docker", ["compose", "-f", FIXTURE, "down", "--remove-orphans", "-t", "1"], {
      stdio: "ignore",
      timeout: 30_000,
    });
  }, 60_000);

  test("each worker produces a HandshakeRequest line accepted by handshake_oracle", () => {
    // Run-once mode: `docker compose up --abort-on-container-exit` blocks
    // until all services exit, so we can collect logs after.
    const up = spawnSync(
      "docker",
      [
        "compose",
        "-f",
        FIXTURE,
        "up",
        "--abort-on-container-exit",
        "--exit-code-from",
        "worker-1",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      },
    );
    // Up command may exit non-zero on container exit codes; we tolerate that
    // and inspect logs.
    expect(up.error).toBeUndefined();

    const responses: Array<{ session_id: string; negotiated_protocol: string }> = [];

    for (const svc of SERVICES) {
      const logs = spawnSync(
        "docker",
        ["compose", "-f", FIXTURE, "logs", "--no-color", "--no-log-prefix", svc],
        { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
      );
      expect(logs.status, `logs for ${svc} exited cleanly`).toBe(0);
      const out = logs.stdout.toString();
      // Grab the first line that parses as a HandshakeRequest.
      const line = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith("{") && l.includes("apohara_version"));
      expect(line, `service ${svc} should emit a HandshakeRequest line`).toBeDefined();

      // Feed to handshake_oracle.
      const oracle = ORACLE as string;
      const oracleRun = spawnSync(oracle, [], {
        input: `${line}\n`,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10_000,
      });
      expect(oracleRun.status, `oracle accepts ${svc}'s line`).toBe(0);
      const respLine = oracleRun.stdout.toString().trim();
      const parsed = JSON.parse(respLine) as { session_id: string; negotiated_protocol: string };
      expect(parsed.negotiated_protocol).toBe("apohara-worker/1");
      expect(parsed.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
      responses.push(parsed);
    }

    expect(responses.length).toBe(3);
    // Distinct session ids per worker.
    const ids = new Set(responses.map((r) => r.session_id));
    expect(ids.size).toBe(3);
  }, 180_000);
});

describe("G6.C.10 — environment preflight", () => {
  test("documents skip conditions for operators", () => {
    // This test always runs and surfaces *why* the heavy test skipped so CI
    // can show a clear signal instead of silent missing coverage.
    if (!DOCKER_OK) {
      // eslint-disable-next-line no-console
      console.warn("[G6.C.10] docker compose not available; e2e skipped");
    }
    if (DOCKER_OK && ORACLE === null) {
      // eslint-disable-next-line no-console
      console.warn(
        "[G6.C.10] handshake_oracle bin not built; run `cargo build -p apohara-remote-worker --bin handshake_oracle`",
      );
    }
    expect(typeof RUN_IT).toBe("boolean");
  });
});

// Keep TS happy when `homedir` is imported but unused in non-docker paths.
void homedir;
void execFileSync;
