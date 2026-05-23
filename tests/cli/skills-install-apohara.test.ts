/**
 * G7.5.E.2 — installApoharaSkill convenience wrapper.
 *
 * Reads `templates/skill-apohara/SKILL.md` (shipped by G7.5.E.1, commit
 * 7e4ebd0) and delegates to G5.I.2's `installSkillCanonical` for one of
 * the 3 active providers. Lives next to the canonical install primitive
 * in `src/cli/skills-install.ts`.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { installApoharaSkill } from "../../src/cli/skills-install";

let home: string;
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "apohara-skill-"));
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

test("installApoharaSkill('claude') drops SKILL.md in ~/.claude/skills/apohara/", async () => {
	const installedPath = await installApoharaSkill("claude", home);
	expect(installedPath).toBe(
		join(home, ".claude", "skills", "apohara", "SKILL.md"),
	);
	const content = await readFile(installedPath, "utf-8");
	expect(content).toContain("name: apohara");
	expect(content).toContain("Multi-AI Orchestrator");
});

test("installApoharaSkill('codex') drops SKILL.md in ~/.codex/skills/apohara/", async () => {
	const installedPath = await installApoharaSkill("codex", home);
	expect(installedPath).toBe(
		join(home, ".codex", "skills", "apohara", "SKILL.md"),
	);
});

test("installApoharaSkill('opencode') drops SKILL.md in ~/.config/opencode/skills/apohara/", async () => {
	const installedPath = await installApoharaSkill("opencode", home);
	expect(installedPath).toBe(
		join(home, ".config", "opencode", "skills", "apohara", "SKILL.md"),
	);
});

test("installApoharaSkill is idempotent — second call overwrites with same content", async () => {
	const p1 = await installApoharaSkill("claude", home);
	const p2 = await installApoharaSkill("claude", home);
	expect(p1).toBe(p2);
	const content = await readFile(p2, "utf-8");
	expect(content).toContain("name: apohara");
});
