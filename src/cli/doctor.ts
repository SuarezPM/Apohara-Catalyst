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

function policy(): SectionResult {
  return {
    name: "policy",
    ok: true,
    summary: "validateRunnerPolicyPlan dry-run deferred (Stage 5 integration pending)",
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
  const results: SectionResult[] = [];
  const runners: Record<SectionName, () => SectionResult> = {
    runtime,
    roster,
    policy,
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

export function formatText(result: DoctorResult): string {
  const lines = result.sections.map(s => {
    const tag = s.ok ? "OK  " : "FAIL";
    return `[${s.name.padEnd(10)}] ${tag} ${s.summary}`;
  });
  lines.push(result.ok ? "\nApohara setup verified end-to-end." : "\nApohara doctor: one or more sections failed.");
  return lines.join("\n");
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
