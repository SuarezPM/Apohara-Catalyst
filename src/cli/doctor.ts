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
import { existsSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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
  | "assigned";

export const ALL_SECTIONS: SectionName[] = [
  "runtime", "roster", "policy", "sandbox", "ledger", "mcp", "assigned",
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
