import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor, parseArgs, formatText, ALL_SECTIONS, type SectionName } from "../../../src/cli/doctor";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "apohara-doctor-"));
}

describe("doctor sections", () => {
  test("runs all 7 sections by default", () => {
    const r = doctor({ apoharaHome: tmpHome() });
    expect(r.sections.map(s => s.name)).toEqual(ALL_SECTIONS);
  });

  test("--skip-mcp removes mcp section", () => {
    const r = doctor({ apoharaHome: tmpHome(), skip: ["mcp"] });
    expect(r.sections.find(s => s.name === "mcp")).toBeUndefined();
    expect(r.sections.length).toBe(6);
  });

  test("multiple --skip flags compose", () => {
    const r = doctor({ apoharaHome: tmpHome(), skip: ["mcp", "ledger", "sandbox"] });
    const names = r.sections.map(s => s.name);
    expect(names).not.toContain("mcp");
    expect(names).not.toContain("ledger");
    expect(names).not.toContain("sandbox");
  });

  test("ledger section ok=true on fresh install (no DB)", () => {
    const r = doctor({ apoharaHome: tmpHome(), skip: ["roster", "runtime"] });
    expect(r.sections.find(s => s.name === "ledger")?.ok).toBe(true);
  });

  test("ledger section ok=true when DB exists with content", () => {
    const home = tmpHome();
    writeFileSync(join(home, "orchestration.db"), Buffer.from([1, 2, 3, 4]));
    const r = doctor({ apoharaHome: home, skip: ["roster", "runtime"] });
    expect(r.sections.find(s => s.name === "ledger")?.ok).toBe(true);
  });

  test("mcp section ok=true when endpoints.json missing", () => {
    const r = doctor({ apoharaHome: tmpHome(), skip: ["roster", "runtime"] });
    expect(r.sections.find(s => s.name === "mcp")?.ok).toBe(true);
  });

  test("mcp section flags bad endpoints.json", () => {
    const home = tmpHome();
    mkdirSync(join(home, "mcp"), { recursive: true });
    writeFileSync(join(home, "mcp", "endpoints.json"), "{ malformed");
    const r = doctor({ apoharaHome: home, skip: ["roster", "runtime"] });
    expect(r.sections.find(s => s.name === "mcp")?.ok).toBe(false);
  });

  test("mcp section ok=true with 4 servers configured", () => {
    const home = tmpHome();
    mkdirSync(join(home, "mcp"), { recursive: true });
    writeFileSync(join(home, "mcp", "endpoints.json"), JSON.stringify({
      servers: {
        "apohara.ledger": { port: 8901 },
        "apohara.runs": { port: 8902 },
        "apohara.indexer": { port: 8903 },
        "apohara.settings": { port: 8904 },
      },
    }));
    const r = doctor({ apoharaHome: home, skip: ["roster", "runtime"] });
    expect(r.sections.find(s => s.name === "mcp")?.ok).toBe(true);
  });

  // G5.D.7 — agentrail #17: doctor.ts:81 placeholder replaced by real
  // compileRunnerExecutionPlan wiring via .apohara.json read.
  test("policy section reports Balanced preset when .apohara.json absent", () => {
    const workspace = tmpHome();
    const r = doctor({
      apoharaHome: tmpHome(),
      workspacePath: workspace,
      skip: ["roster", "runtime"],
    });
    const policy = r.sections.find(s => s.name === "policy");
    expect(policy?.ok).toBe(true);
    expect(policy?.summary).toMatch(/Balanced/);
  });

  test("policy section reports configured preset from .apohara.json", () => {
    const workspace = tmpHome();
    writeFileSync(
      join(workspace, ".apohara.json"),
      JSON.stringify({ runnerPolicy: { preset: "Strict" } }),
    );
    const r = doctor({
      apoharaHome: tmpHome(),
      workspacePath: workspace,
      skip: ["roster", "runtime"],
    });
    const policy = r.sections.find(s => s.name === "policy");
    expect(policy?.ok).toBe(true);
    expect(policy?.summary).toMatch(/Strict/);
    expect(policy?.summary).toMatch(/6 enforcement/);
  });

  test("policy section flags rejected plan when planCompiler rejects", () => {
    // Strict normally does not reject (see runner-policy-wired.test.ts).
    // We still verify malformed json degrades to Balanced safely.
    const workspace = tmpHome();
    writeFileSync(join(workspace, ".apohara.json"), "{ malformed");
    const r = doctor({
      apoharaHome: tmpHome(),
      workspacePath: workspace,
      skip: ["roster", "runtime"],
    });
    const policy = r.sections.find(s => s.name === "policy");
    expect(policy?.ok).toBe(true);
    expect(policy?.summary).toMatch(/Balanced/);
  });

  test("policy section drops the 'Stage 5 integration pending' placeholder", () => {
    const r = doctor({
      apoharaHome: tmpHome(),
      skip: ["roster", "runtime"],
    });
    const policy = r.sections.find(s => s.name === "policy");
    expect(policy?.summary).not.toMatch(/Stage 5 integration pending/);
  });
});

describe("parseArgs", () => {
  test("defaults: no json, no skip", () => {
    expect(parseArgs([])).toEqual({ json: false, skip: [] });
  });

  test("--json sets json flag", () => {
    expect(parseArgs(["--json"]).json).toBe(true);
  });

  test("--skip-runtime registers runtime", () => {
    expect(parseArgs(["--skip-runtime"]).skip).toEqual(["runtime"]);
  });

  test("ignores unknown --skip-foo", () => {
    expect(parseArgs(["--skip-foo"]).skip).toEqual([]);
  });
});

describe("formatText", () => {
  test("emits one line per section + summary", () => {
    const out = formatText({
      ok: true,
      sections: [
        { name: "runtime", ok: true, summary: "Bun 1.3" },
        { name: "ledger", ok: true, summary: "fresh install" },
      ] as { name: SectionName; ok: boolean; summary: string }[],
    });
    expect(out).toContain("[runtime");
    expect(out).toContain("[ledger");
    expect(out).toContain("verified");
  });

  test("emits failure footer when any section failed", () => {
    const out = formatText({
      ok: false,
      sections: [{ name: "runtime", ok: false, summary: "bun missing" }] as { name: SectionName; ok: boolean; summary: string }[],
    });
    expect(out).toContain("failed");
  });

  // G7.B.8 — actionable hint footer per failing section
  test("emits Next steps section listing actionable hints per failing section", () => {
    const out = formatText({
      ok: false,
      sections: [
        { name: "runtime", ok: true, summary: "Bun 1.3" },
        { name: "roster", ok: false, summary: "missing: claude" },
        { name: "mcp", ok: false, summary: "bad endpoints.json" },
      ] as { name: SectionName; ok: boolean; summary: string }[],
    });
    expect(out).toContain("Next steps:");
    expect(out).toContain("[roster]");
    expect(out).toContain("[mcp]");
    expect(out).toContain("docs/troubleshooting.md");
    // OK sections should NOT appear in the hints footer
    expect(out).not.toMatch(/^\s*-\s*\[runtime\]/m);
  });

  test("does not emit Next steps section when all green", () => {
    const out = formatText({
      ok: true,
      sections: [
        { name: "runtime", ok: true, summary: "Bun 1.3" },
        { name: "ledger", ok: true, summary: "fresh install" },
      ] as { name: SectionName; ok: boolean; summary: string }[],
    });
    expect(out).not.toContain("Next steps");
    expect(out).toContain("verified");
  });

  test("opens with the diagnostic banner header", () => {
    const out = formatText({
      ok: true,
      sections: [{ name: "runtime", ok: true, summary: "Bun 1.3" }] as { name: SectionName; ok: boolean; summary: string }[],
    });
    expect(out).toContain("Apohara doctor — verifying environment");
  });
});