/**
 * culture #11 — apohara skills install <provider> drops a SKILL.md
 * into the provider's skill directory.
 *
 * G5.E.7 shipped the minimal in-tree layout (`<root>/<provider>/skills/`).
 * G5.I.2 completes this by adding `installSkillCanonical()` which writes
 * to each provider's REAL on-disk layout:
 *
 *   - claude    → `~/.claude/skills/<name>/SKILL.md`     (claude-code-cli)
 *   - codex     → `~/.codex/skills/<name>/SKILL.md`      (codex-cli)
 *   - opencode  → `~/.config/opencode/skills/<name>/SKILL.md`
 *                  (matches the upstream config discovery from
 *                  CLAUDE.md's past-incident note — opencode reads
 *                  `~/.config/opencode/` NOT `~/.opencode/`)
 *
 * Both functions stay side-effect-free except for the filesystem write.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SkillProvider = "claude" | "codex" | "opencode";

export interface InstallSkillArgs {
	provider: SkillProvider;
	name: string;
	content: string;
	targetRoot?: string;
}

export interface InstallSkillCanonicalArgs {
	provider: SkillProvider;
	name: string;
	content: string;
	/**
	 * Override `$HOME`. Used by tests. Production callers should omit this
	 * and let the function read `process.env.HOME`.
	 */
	homeRoot?: string;
}

export async function installSkill(args: InstallSkillArgs): Promise<string> {
	const root = args.targetRoot ?? process.env.HOME ?? ".";
	const dir = join(root, args.provider, "skills", args.name);
	await mkdir(dir, { recursive: true });
	const path = join(dir, "SKILL.md");
	await writeFile(path, args.content, "utf-8");
	return path;
}

/**
 * Resolve the canonical skill-root directory for a given provider, relative
 * to the supplied home (or `$HOME`). Pure — no filesystem effects.
 */
export function canonicalSkillRoot(
	provider: SkillProvider,
	homeRoot?: string,
): string {
	const home = homeRoot ?? process.env.HOME ?? ".";
	switch (provider) {
		case "claude":
			return join(home, ".claude", "skills");
		case "codex":
			return join(home, ".codex", "skills");
		case "opencode":
			// opencode uses `~/.config/opencode/` per upstream config discovery
			// (verified against opencode 1.15+). Matches the hookConfigPath
			// in `src/core/providers/agent-config.ts`.
			return join(home, ".config", "opencode", "skills");
		default: {
			const _exhaustive: never = provider;
			throw new Error(`canonicalSkillRoot: unknown provider ${_exhaustive}`);
		}
	}
}

/**
 * Install a skill at the provider's CANONICAL on-disk location.
 *
 * Idempotent like `installSkill` — re-running with the same args overwrites.
 * Returns the absolute path to the written `SKILL.md`.
 */
export async function installSkillCanonical(
	args: InstallSkillCanonicalArgs,
): Promise<string> {
	if (typeof args.name !== "string" || args.name.length === 0) {
		throw new Error("installSkillCanonical: name is required");
	}
	if (args.name.includes("/") || args.name.includes("\\") || args.name.includes("..")) {
		throw new Error(
			`installSkillCanonical: invalid name "${args.name}" — must not contain slashes or ..`,
		);
	}
	const root = canonicalSkillRoot(args.provider, args.homeRoot);
	const dir = join(root, args.name);
	await mkdir(dir, { recursive: true });
	const path = join(dir, "SKILL.md");
	await writeFile(path, args.content, "utf-8");
	return path;
}
