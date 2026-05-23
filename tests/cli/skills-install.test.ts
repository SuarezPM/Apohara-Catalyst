import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill } from "../../src/cli/skills-install";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "apohara-skill-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test("installSkill writes SKILL.md to provider's skill dir", async () => {
	await installSkill({
		provider: "claude",
		name: "debug-runner",
		content: "# Debug runner skill\n\nSteps...",
		targetRoot: root,
	});
	const written = await readFile(
		join(root, "claude", "skills", "debug-runner", "SKILL.md"),
		"utf-8",
	);
	expect(written).toContain("Debug runner skill");
});

test("installSkill is idempotent (rewriting same content doesn't error)", async () => {
	const args = {
		provider: "claude" as const,
		name: "x",
		content: "abc",
		targetRoot: root,
	};
	await installSkill(args);
	await installSkill(args);
	// No throw
});
