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
});