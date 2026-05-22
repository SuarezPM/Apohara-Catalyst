import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTrustForProvider } from "../../../src/core/providers/trust-presets";

let workDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-trust-"));
  originalHome = process.env.HOME;
  process.env.HOME = workDir;
});
afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(workDir, { recursive: true, force: true });
});

test("applyTrustForProvider claude writes ~/.claude/settings.json with trustedFolders entry", async () => {
  await applyTrustForProvider("claude-code-cli", "/path/to/workspace");
  const settings = JSON.parse(await readFile(join(workDir, ".claude/settings.json"), "utf-8"));
  expect(settings.trustedFolders).toContain("/path/to/workspace");
});

test("applyTrustForProvider claude is idempotent (no duplicate entries)", async () => {
  await applyTrustForProvider("claude-code-cli", "/path/to/workspace");
  await applyTrustForProvider("claude-code-cli", "/path/to/workspace");
  const settings = JSON.parse(await readFile(join(workDir, ".claude/settings.json"), "utf-8"));
  expect(settings.trustedFolders.filter((p: string) => p === "/path/to/workspace").length).toBe(1);
});

test("applyTrustForProvider opencode-go is a no-op (no preflightTrust)", async () => {
  await applyTrustForProvider("opencode-go", "/path/to/workspace");
  const { stat } = await import("node:fs/promises");
  await expect(stat(join(workDir, ".opencode"))).rejects.toThrow();
});

test("applyTrustForProvider preserves existing settings keys", async () => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(join(workDir, ".claude"), { recursive: true });
  await writeFile(join(workDir, ".claude/settings.json"), JSON.stringify({ theme: "dark", apiBase: "..." }));
  await applyTrustForProvider("claude-code-cli", "/path/to/workspace");
  const settings = JSON.parse(await readFile(join(workDir, ".claude/settings.json"), "utf-8"));
  expect(settings.theme).toBe("dark");
  expect(settings.apiBase).toBe("...");
  expect(settings.trustedFolders).toContain("/path/to/workspace");
});