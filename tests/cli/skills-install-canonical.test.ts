/**
 * Tests for G5.I.2 canonical per-provider skill install paths.
 * (Complements G5.E.7's installSkill.)
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	canonicalSkillRoot,
	installSkillCanonical,
} from "../../src/cli/skills-install";

describe("canonicalSkillRoot", () => {
	test("claude → ~/.claude/skills", () => {
		expect(canonicalSkillRoot("claude", "/home/test")).toBe(
			"/home/test/.claude/skills",
		);
	});

	test("codex → ~/.codex/skills", () => {
		expect(canonicalSkillRoot("codex", "/home/test")).toBe(
			"/home/test/.codex/skills",
		);
	});

	test("opencode → ~/.config/opencode/skills", () => {
		expect(canonicalSkillRoot("opencode", "/home/test")).toBe(
			"/home/test/.config/opencode/skills",
		);
	});

	test("falls back to process.env.HOME when homeRoot omitted", () => {
		const root = canonicalSkillRoot("claude");
		expect(root).toContain(".claude/skills");
	});
});

describe("installSkillCanonical", () => {
	let home: string;
	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "apohara-skill-can-"));
	});
	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	test("writes SKILL.md at the canonical claude path", async () => {
		const path = await installSkillCanonical({
			provider: "claude",
			name: "debug-runner",
			content: "# debug-runner\n",
			homeRoot: home,
		});
		expect(path).toBe(
			join(home, ".claude", "skills", "debug-runner", "SKILL.md"),
		);
		const written = await readFile(path, "utf-8");
		expect(written).toContain("debug-runner");
	});

	test("writes SKILL.md at the canonical codex path", async () => {
		const path = await installSkillCanonical({
			provider: "codex",
			name: "x",
			content: "x",
			homeRoot: home,
		});
		expect(path).toContain(join(".codex", "skills", "x", "SKILL.md"));
	});

	test("writes SKILL.md at the canonical opencode path (~/.config/opencode/)", async () => {
		const path = await installSkillCanonical({
			provider: "opencode",
			name: "y",
			content: "y",
			homeRoot: home,
		});
		expect(path).toContain(
			join(".config", "opencode", "skills", "y", "SKILL.md"),
		);
	});

	test("idempotent — overwrites on re-install", async () => {
		const args = {
			provider: "claude" as const,
			name: "z",
			content: "v1",
			homeRoot: home,
		};
		await installSkillCanonical(args);
		await installSkillCanonical({ ...args, content: "v2" });
		const written = await readFile(
			join(home, ".claude", "skills", "z", "SKILL.md"),
			"utf-8",
		);
		expect(written).toBe("v2");
	});

	test("rejects empty name", async () => {
		await expect(
			installSkillCanonical({
				provider: "claude",
				name: "",
				content: "x",
				homeRoot: home,
			}),
		).rejects.toThrow(/name is required/);
	});

	test("rejects path-traversal names", async () => {
		await expect(
			installSkillCanonical({
				provider: "claude",
				name: "../escape",
				content: "x",
				homeRoot: home,
			}),
		).rejects.toThrow(/invalid name/);
	});

	test("rejects slash in name", async () => {
		await expect(
			installSkillCanonical({
				provider: "claude",
				name: "a/b",
				content: "x",
				homeRoot: home,
			}),
		).rejects.toThrow(/invalid name/);
	});
});
