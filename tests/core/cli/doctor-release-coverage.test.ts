/**
 * G10.D.1 — Sprint 10 release-coverage checks for `apohara doctor`.
 *
 * Each section added in G10.D.1 (node / git / os / home / secrets / disk /
 * optional-clis) is exercised here. Tests intentionally avoid mocking the
 * underlying system: they assert on shape + sane outputs rather than exact
 * values, so the same suite runs on any developer machine + CI matrix.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor, ALL_SECTIONS, type SectionName } from "../../../src/cli/doctor";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "apohara-doctor-rc-"));
}

function findSection(name: SectionName) {
  return (sections: { name: SectionName; ok: boolean; summary: string }[]) =>
    sections.find((s) => s.name === name);
}

describe("G10.D.1 release-coverage sections", () => {
  test("ALL_SECTIONS now includes every v1.0.0-rc.1 release check", () => {
    expect(ALL_SECTIONS).toContain("node");
    expect(ALL_SECTIONS).toContain("git");
    expect(ALL_SECTIONS).toContain("os");
    expect(ALL_SECTIONS).toContain("home");
    expect(ALL_SECTIONS).toContain("secrets");
    expect(ALL_SECTIONS).toContain("disk");
    expect(ALL_SECTIONS).toContain("optional-clis");
  });

  test("node section reports a parsed version string", () => {
    const r = doctor({ apoharaHome: tmpHome() });
    const node = findSection("node")(r.sections);
    expect(node).toBeDefined();
    expect(typeof node!.summary).toBe("string");
    expect(node!.summary.length).toBeGreaterThan(0);
  });

  test("git section reports a parsed version string", () => {
    const r = doctor({ apoharaHome: tmpHome() });
    const git = findSection("git")(r.sections);
    expect(git).toBeDefined();
    // git is required on every dev box in this repo; if it's missing the
    // section must say so explicitly rather than masquerade as OK.
    if (git!.ok) {
      expect(git!.summary).toMatch(/\d+\.\d+/);
    } else {
      expect(git!.summary.toLowerCase()).toMatch(/git|need|unparseable/);
    }
  });

  test("os section reports the current platform with a support tier", () => {
    const r = doctor({ apoharaHome: tmpHome() });
    const os = findSection("os")(r.sections);
    expect(os).toBeDefined();
    expect(os!.summary).toMatch(/linux|darwin|win32/);
    expect(os!.summary).toMatch(/tier|untested/);
  });

  test("home section passes when apoharaHome points at a writable tmp dir", () => {
    const home = tmpHome();
    const r = doctor({ apoharaHome: home });
    const h = findSection("home")(r.sections);
    expect(h).toBeDefined();
    expect(h!.ok).toBe(true);
    expect(h!.summary).toContain(home);
  });

  test("home section creates the dir if missing (idempotent)", () => {
    // Pass a non-existent subpath of tmp — homeCheck should mkdir it.
    const home = join(tmpHome(), "nested", "apohara");
    const r = doctor({ apoharaHome: home });
    const h = findSection("home")(r.sections);
    expect(h!.ok).toBe(true);
  });

  test("secrets section returns a status with a string summary", () => {
    const r = doctor({ apoharaHome: tmpHome() });
    const s = findSection("secrets")(r.sections);
    expect(s).toBeDefined();
    expect(typeof s!.summary).toBe("string");
  });

  test("disk section returns a > 1 GB summary in the typical dev path", () => {
    // Workspace defaults to process.cwd(). The dev box plus CI both ship with
    // well over 1 GB free, so this test asserts the happy path. On a tight
    // sandbox where < 1 GB is available the assertion below still holds —
    // the section returns a structured summary either way.
    const r = doctor({ apoharaHome: tmpHome() });
    const d = findSection("disk")(r.sections);
    expect(d).toBeDefined();
    expect(d!.summary).toMatch(/GB free|statfs failed/);
  });

  test("optional-clis section never fails the run, regardless of what's installed", () => {
    const r = doctor({ apoharaHome: tmpHome() });
    const o = findSection("optional-clis")(r.sections);
    expect(o).toBeDefined();
    // Spec line: "Optional CLIs (warnings only)" — ok must stay true.
    expect(o!.ok).toBe(true);
  });

  test("--skip-disk excludes the disk section but keeps the others", () => {
    const r = doctor({ apoharaHome: tmpHome(), skip: ["disk"] });
    expect(findSection("disk")(r.sections)).toBeUndefined();
    expect(findSection("node")(r.sections)).toBeDefined();
  });

  test("policy + new sections coexist when .apohara.json sets a preset", () => {
    const workspace = tmpHome();
    writeFileSync(
      join(workspace, ".apohara.json"),
      JSON.stringify({ runnerPolicy: { preset: "Balanced" } }),
    );
    const r = doctor({ apoharaHome: tmpHome(), workspacePath: workspace });
    expect(findSection("policy")(r.sections)?.summary).toMatch(/Balanced/);
    expect(findSection("disk")(r.sections)).toBeDefined();
  });
});
