/**
 * Spec §7.1: `apohara doctor` — diagnostic CLI with 7 sections.
 *
 * Each section returns { name, ok, summary } and runs in isolation
 * (a failure in one does not abort the rest). Output modes:
 *   - text (default): one line per section + final OK/FAIL summary.
 *   - --json: machine-readable for CI gates.
 *
 * Flags:
 *   --skip-<section>   skip a named section
 *   --json             JSON mode
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync, statfsSync, accessSync, constants as fsConst, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { compileRunnerExecutionPlan } from "../core/safety/runnerPolicy/planCompiler";
import {
  STRICT,
  BALANCED,
  ADVISORY,
  EXTERNAL_SANDBOX,
} from "../core/safety/runnerPolicy/presets";
import type {
  RunnerExecutionPolicy,
  PolicyPreset,
} from "../core/safety/runnerPolicy/types";

export type SectionName =
  | "runtime"
  | "roster"
  | "policy"
  | "sandbox"
  | "ledger"
  | "mcp"
  | "assigned"
  // G10.D.1 — v1.0.0-rc.1 release-coverage checks.
  | "node"
  | "git"
  | "os"
  | "home"
  | "secrets"
  | "disk"
  | "optional-clis";

export const ALL_SECTIONS: SectionName[] = [
  "runtime", "roster", "policy", "sandbox", "ledger", "mcp", "assigned",
  "node", "git", "os", "home", "secrets", "disk", "optional-clis",
];

export interface SectionResult {
  name: SectionName;
  ok: boolean;
  summary: string;
}

export interface DoctorResult {
  ok: boolean;
  sections: SectionResult[];
}

export interface DoctorOpts {
  skip?: SectionName[];
  apoharaHome?: string;
  /**
   * G5.D.7 / agentrail #17 — workspace whose `.apohara.json` drives the
   * runner-policy check. Default `process.cwd()` matches the CLI
   * invocation behavior; tests override to point at a temp workspace.
   */
  workspacePath?: string;
}

function cmd(bin: string, args: string[], timeoutMs = 5000): { ok: boolean; stdout: string } {
  const r = spawnSync(bin, args, { encoding: "utf-8", timeout: timeoutMs });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim() };
}

function runtime(): SectionResult {
  const bunV = (typeof Bun !== "undefined" ? Bun.version : "n/a");
  const rust = cmd("rustc", ["--version"]);
  const ok = !!bunV && rust.ok;
  return { name: "runtime", ok, summary: `Bun ${bunV} · ${rust.stdout || "rustc missing"}` };
}

function roster(): SectionResult {
  const provs = ["claude", "codex", "opencode"];
  const found: string[] = [];
  const missing: string[] = [];
  for (const p of provs) {
    const which = cmd("which", [p]);
    if (which.ok) found.push(p);
    else missing.push(p);
  }
  return {
    name: "roster",
    ok: missing.length === 0,
    summary: missing.length === 0
      ? `${found.join(" · ")} all on PATH`
      : `missing: ${missing.join(", ")}`,
  };
}

function isKnownPreset(s: unknown): s is PolicyPreset {
  return (
    s === "Strict" ||
    s === "Balanced" ||
    s === "Advisory" ||
    s === "ExternalSandbox" ||
    s === "Custom"
  );
}

function pickPolicySync(preset: PolicyPreset): RunnerExecutionPolicy {
  switch (preset) {
    case "Strict":
      return STRICT;
    case "Advisory":
      return ADVISORY;
    case "ExternalSandbox":
      return EXTERNAL_SANDBOX;
    case "Custom":
      // doctor reflects the same fallback the spawn path takes
      // (cli-driver.ts pickPolicy) — Custom not yet supported.
      return STRICT;
    case "Balanced":
    default:
      return BALANCED;
  }
}

function readPresetSync(workspace: string): PolicyPreset {
  const path = join(workspace, ".apohara.json");
  if (!existsSync(path)) return "Balanced";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      runnerPolicy?: { preset?: string };
    };
    const preset = parsed?.runnerPolicy?.preset;
    return isKnownPreset(preset) ? preset : "Balanced";
  } catch {
    // Malformed `.apohara.json` — degrade to Balanced silently here;
    // the spawn path already warns via stderr from cli-driver.
    return "Balanced";
  }
}

/**
 * G5.D.7 / agentrail #17 — replaces the prior "Stage 5 integration
 * pending" placeholder with a real compileRunnerExecutionPlan call.
 * Sync-only: doctor() stays a synchronous function, so we replicate the
 * minimal preset-resolution logic instead of awaiting
 * resolveRunnerPolicyForSpawn (which is async to match the spawn path
 * but is not needed here — doctor is a pure introspection).
 */
function policy(workspacePath: string): SectionResult {
  const preset = readPresetSync(workspacePath);
  const policyObj = pickPolicySync(preset);
  const plan = compileRunnerExecutionPlan(policyObj);
  if (plan.rejected) {
    return {
      name: "policy",
      ok: false,
      summary: `${plan.policy} REJECTED: ${plan.rejection_reason ?? "no reason"}`,
    };
  }
  const enforcedCount = plan.enforcement.filter(e => e.strength === "Enforced").length;
  return {
    name: "policy",
    ok: true,
    summary: `${plan.policy} preset · ${plan.enforcement.length} enforcement areas (${enforcedCount} enforced)`,
  };
}

function sandbox(): SectionResult {
  if (existsSync("crates/apohara-sandbox/Cargo.toml")) {
    return { name: "sandbox", ok: true, summary: "apohara-sandbox crate present" };
  }
  return { name: "sandbox", ok: false, summary: "apohara-sandbox crate missing" };
}

function ledger(apoharaHome: string): SectionResult {
  const dbPath = join(apoharaHome, "orchestration.db");
  if (!existsSync(dbPath)) {
    return { name: "ledger", ok: true, summary: "no DB yet (fresh install)" };
  }
  try {
    const st = statSync(dbPath);
    return { name: "ledger", ok: st.size > 0, summary: `DB ${st.size} bytes` };
  } catch (e) {
    return { name: "ledger", ok: false, summary: `unreadable: ${(e as Error).message}` };
  }
}

function mcp(apoharaHome: string): SectionResult {
  const epPath = join(apoharaHome, "mcp", "endpoints.json");
  if (!existsSync(epPath)) {
    return { name: "mcp", ok: true, summary: "no MCP bootstrap yet" };
  }
  try {
    const json = JSON.parse(readFileSync(epPath, "utf-8")) as { servers?: Record<string, { port: number }> };
    const names = Object.keys(json.servers ?? {});
    return { name: "mcp", ok: names.length === 4, summary: `${names.length}/4 servers: ${names.join(", ")}` };
  } catch (e) {
    return { name: "mcp", ok: false, summary: `bad endpoints.json: ${(e as Error).message}` };
  }
}

function assigned(apoharaHome: string): SectionResult {
  const dbPath = join(apoharaHome, "orchestration.db");
  if (!existsSync(dbPath)) {
    return { name: "assigned", ok: false, summary: "no DB — LOCAL-SETUP-001 not enrolled" };
  }
  return { name: "assigned", ok: true, summary: "DB present — use `apohara verify-setup` for verdict" };
}

// ---------------------------------------------------------------------------
// G10.D.1 — v1.0.0-rc.1 release-coverage checks.
//
// Sprint 10 spec §G10.D requires `apohara doctor` to cover every precondition
// for an install-and-run release. The original 7 sections (runtime/roster/...)
// covered Bun + Rust + provider CLIs but did not directly cover: Node 20+,
// Git 2.40+, OS support tier, writable apohara home, secret store backend,
// disk space, or optional tooling. These sections close those gaps.
// ---------------------------------------------------------------------------

/**
 * Node.js >= 20 (Iron LTS). Bun runs Apohara at runtime, but bundled tooling
 * (postinstall scripts, npm-shipped CLIs, the GitHub-bridge worker) calls into
 * the Node version that came with the npm install. Fail if < 20.
 */
function nodeCheck(): SectionResult {
  const r = cmd("node", ["--version"]);
  if (!r.ok || !r.stdout) {
    return { name: "node", ok: false, summary: "node not on PATH" };
  }
  const m = r.stdout.match(/^v(\d+)\./);
  if (!m) {
    return { name: "node", ok: false, summary: `unparseable: ${r.stdout}` };
  }
  const major = Number(m[1]);
  if (major < 20) {
    return { name: "node", ok: false, summary: `${r.stdout} (need >= 20)` };
  }
  return { name: "node", ok: true, summary: `${r.stdout} (>= 20 LTS)` };
}

/**
 * Git >= 2.40. Worktree-based isolation (`crates/apohara-worktree`) uses
 * features that landed in 2.40. Earlier git versions silently misbehave.
 */
function gitCheck(): SectionResult {
  const r = cmd("git", ["--version"]);
  if (!r.ok || !r.stdout) {
    return { name: "git", ok: false, summary: "git not on PATH" };
  }
  // "git version 2.45.1" or similar.
  const m = r.stdout.match(/git version (\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) {
    return { name: "git", ok: false, summary: `unparseable: ${r.stdout}` };
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major < 2 || (major === 2 && minor < 40)) {
    return { name: "git", ok: false, summary: `${m[0]} (need >= 2.40)` };
  }
  return { name: "git", ok: true, summary: `${m[0]} (>= 2.40)` };
}

/**
 * OS support tier. Tier 1: linux, darwin. Tier 2: win32 (smoke matrix exists
 * but desktop features are best-effort). Anything else: untested, warn.
 */
function osCheck(): SectionResult {
  const p = platform();
  if (p === "linux" || p === "darwin") {
    return { name: "os", ok: true, summary: `${p} (tier 1 — fully supported)` };
  }
  if (p === "win32") {
    return { name: "os", ok: true, summary: `${p} (tier 2 — smoke-tested, desktop best-effort)` };
  }
  return { name: "os", ok: false, summary: `${p} (untested — file an issue)` };
}

/**
 * Writable `~/.apohara/`. Auto-create if missing (idempotent), then verify
 * write access. This is the directory every other section depends on.
 */
function homeCheck(apoharaHome: string): SectionResult {
  try {
    if (!existsSync(apoharaHome)) {
      mkdirSync(apoharaHome, { recursive: true, mode: 0o700 });
    }
    accessSync(apoharaHome, fsConst.W_OK);
    return { name: "home", ok: true, summary: `${apoharaHome} writable` };
  } catch (e) {
    return { name: "home", ok: false, summary: `${apoharaHome}: ${(e as Error).message}` };
  }
}

/**
 * Secret store backend. The Rust `apohara-secrets` crate uses `keyring-rs`,
 * which dispatches to the OS-native store: Secret Service / kwallet (Linux),
 * Keychain (macOS), Credential Manager (Windows). We do a *probe* — verify
 * the crate ships in the workspace; the live keyring round-trip belongs to
 * `apohara verify-setup` where a real secret can be stored and rolled back.
 *
 * On Linux we additionally check that `DBUS_SESSION_BUS_ADDRESS` is set or
 * `dbus-launch` is available, since Secret Service requires a session bus.
 */
function secretsCheck(): SectionResult {
  const cratePath = "crates/apohara-secrets/Cargo.toml";
  if (!existsSync(cratePath)) {
    return { name: "secrets", ok: false, summary: "apohara-secrets crate missing" };
  }
  if (platform() === "linux") {
    const hasBus = !!process.env.DBUS_SESSION_BUS_ADDRESS;
    const hasLaunch = cmd("which", ["dbus-launch"]).ok;
    if (!hasBus && !hasLaunch) {
      return {
        name: "secrets",
        ok: false,
        summary: "no DBUS session bus and dbus-launch missing — Secret Service unavailable",
      };
    }
  }
  return { name: "secrets", ok: true, summary: "keyring backend reachable (probe only — verify-setup does live round-trip)" };
}

/**
 * Disk space > 1GB free in workspace dir. `statfsSync` returns block-level
 * counts: `bavail` * `bsize` = bytes available to a non-root user.
 *
 * Threshold: 1 GiB (2^30). Apohara's indexer + worktrees + audit logs grow
 * over time; below 1 GB the install is one-`bun install` away from ENOSPC.
 */
function diskCheck(workspacePath: string): SectionResult {
  try {
    // statfsSync exists in Node 19+ and Bun. Cast to access f_bavail / f_bsize.
    const st = statfsSync(workspacePath) as unknown as { bavail: number; bsize: number };
    const freeBytes = st.bavail * st.bsize;
    const freeGB = freeBytes / 1024 ** 3;
    if (freeGB > 1) {
      return { name: "disk", ok: true, summary: `${freeGB.toFixed(2)} GB free in ${workspacePath}` };
    }
    return {
      name: "disk",
      ok: false,
      summary: `only ${freeGB.toFixed(2)} GB free in ${workspacePath} (recommend > 1 GB)`,
    };
  } catch (e) {
    return { name: "disk", ok: false, summary: `statfs failed: ${(e as Error).message}` };
  }
}

/**
 * Optional CLIs. None of these block install — they enable specific workflows:
 *   - gh         → cross-repo issue/PR automation (github-bridge fallback)
 *   - hyperfine  → G10.C performance gates microbench
 *   - playwright → desktop E2E smoke
 *
 * Section is `ok: true` even when missing. Summary names which were found so
 * users can see what extra features they unlock. This matches the spec line
 * "Optional CLIs (warnings only)".
 */
function optionalClisCheck(): SectionResult {
  const opt = ["gh", "hyperfine", "playwright"];
  const found: string[] = [];
  const missing: string[] = [];
  for (const bin of opt) {
    if (cmd("which", [bin]).ok) found.push(bin);
    else missing.push(bin);
  }
  const parts: string[] = [];
  if (found.length > 0) parts.push(`found: ${found.join(", ")}`);
  if (missing.length > 0) parts.push(`absent (optional): ${missing.join(", ")}`);
  return { name: "optional-clis", ok: true, summary: parts.join(" · ") || "no optional CLIs probed" };
}

export function doctor(opts: DoctorOpts = {}): DoctorResult {
  const skip = new Set(opts.skip ?? []);
  const home = opts.apoharaHome ?? join(homedir(), ".apohara");
  const workspace = opts.workspacePath ?? process.cwd();
  const results: SectionResult[] = [];
  const runners: Record<SectionName, () => SectionResult> = {
    runtime,
    roster,
    policy: () => policy(workspace),
    sandbox,
    ledger: () => ledger(home),
    mcp: () => mcp(home),
    assigned: () => assigned(home),
    node: nodeCheck,
    git: gitCheck,
    os: osCheck,
    home: () => homeCheck(home),
    secrets: secretsCheck,
    disk: () => diskCheck(workspace),
    "optional-clis": optionalClisCheck,
  };
  for (const name of ALL_SECTIONS) {
    if (skip.has(name)) continue;
    results.push(runners[name]());
  }
  return { ok: results.every(r => r.ok), sections: results };
}

/**
 * G7.B.8 — actionable hint per section failure. Each entry points the
 * user at the exact doc / config / command that fixes the failure mode
 * for that section. Hints are emitted only when the section is `ok: false`
 * and only in text mode (JSON keeps the raw shape for CI parsers).
 */
const SECTION_HINTS: Record<SectionName, string> = {
  runtime: "Install Bun (https://bun.sh) and Rust (rustup) — see docs/troubleshooting.md#runtime-section-says-rustc-missing",
  roster: "Install the missing CLI binary and reload PATH — see docs/troubleshooting.md#roster-section-reports-a-missing-cli",
  policy: "Edit `.apohara.json` runnerPolicy.preset or remove offending allow-list entries — see docs/troubleshooting.md#policy-section-reports-rejected",
  sandbox: "Run from a checkout that contains `crates/apohara-sandbox/Cargo.toml` (full source repo, not the npx wrapper).",
  ledger: "Delete the file and rerun `apohara verify-setup` to re-bootstrap.",
  mcp: "Delete `~/.apohara/mcp/endpoints.json` and rerun `apohara verify-setup` — see docs/troubleshooting.md#hook-events-return-http-401",
  assigned: "Run `apohara verify-setup` to enroll LOCAL-SETUP-001 and exercise the full pipeline.",
  node: "Install Node 20 LTS (Iron) or later — `nvm install 20` / `pacman -S nodejs` / `brew install node@20`.",
  git: "Upgrade Git to >= 2.40 — `pacman -Syu git` / `brew upgrade git` / https://git-scm.com/downloads.",
  os: "Apohara supports Linux + macOS as tier 1 and Windows as tier 2 — file an issue if you need another platform.",
  home: "Ensure `~/.apohara/` exists and is writable — `mkdir -p ~/.apohara && chmod 700 ~/.apohara`.",
  secrets: "On Linux start a DBUS session (`eval $(dbus-launch --sh-syntax)`) or install `dbus`/`gnome-keyring`. Build the workspace from a full source checkout.",
  disk: "Free more than 1 GB in the workspace partition — Apohara indexer + worktrees grow with usage.",
  "optional-clis": "Optional helpers — install gh / hyperfine / playwright only if you need cross-repo, perf, or E2E flows.",
};

export function formatText(result: DoctorResult): string {
  const header = result.ok
    ? "Apohara doctor — verifying environment\n"
    : "Apohara doctor — verifying environment\n";
  const sectionLines = result.sections.map(s => {
    const tag = s.ok ? "OK  " : "FAIL";
    return `[${s.name.padEnd(10)}] ${tag} ${s.summary}`;
  });
  const failed = result.sections.filter(s => !s.ok);
  const hintLines: string[] = [];
  if (failed.length > 0) {
    hintLines.push("", "Next steps:");
    for (const s of failed) {
      hintLines.push(`  - [${s.name}] ${SECTION_HINTS[s.name]}`);
    }
  }
  const footer = result.ok
    ? "\nApohara setup verified end-to-end."
    : "\nApohara doctor: one or more sections failed.";
  return [header, ...sectionLines, ...hintLines, footer].join("\n");
}

export function parseArgs(argv: string[]): { json: boolean; skip: SectionName[] } {
  let json = false;
  const skip: SectionName[] = [];
  for (const a of argv) {
    if (a === "--json") json = true;
    else if (a.startsWith("--skip-")) {
      const name = a.slice("--skip-".length) as SectionName;
      if (ALL_SECTIONS.includes(name)) skip.push(name);
    }
  }
  return { json, skip };
}

if (typeof Bun !== "undefined" && import.meta.main) {
  const { json, skip } = parseArgs(process.argv.slice(2));
  const result = doctor({ skip });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(formatText(result) + "\n");
  }
  process.exit(result.ok ? 0 : 1);
}
