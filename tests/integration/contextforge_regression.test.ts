/**
 * Spec §7 V-1 acceptance: ContextForge regression must stay at 310/310.
 * Skips gracefully if the sibling repo isn't present (CI may not vendor it).
 */
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const CONTEXTFORGE = resolve(REPO_ROOT, "../apohara-context-forge");

test("contextforge regression: 310/310 stays green", () => {
  if (!existsSync(CONTEXTFORGE)) {
    console.warn(`[skip] ${CONTEXTFORGE} not present — install sibling repo to enforce V-1`);
    return;
  }

  const pytestProbe = spawnSync("bash", ["-c", "command -v pytest"], { encoding: "utf-8" });
  if (pytestProbe.status !== 0) {
    console.warn(`[skip] pytest not on PATH — run \`pipx install pytest\` (or equivalent) to enforce V-1`);
    return;
  }

  const result = spawnSync("bash", ["-c", "PYTHONPATH=. pytest tests/ -q"], {
    cwd: CONTEXTFORGE,
    encoding: "utf-8",
    timeout: 120_000,
  });

  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  expect(result.status, `pytest failed:\n${combined}`).toBe(0);
  expect(combined).toContain("310 passed");
}, { timeout: 130_000 });
