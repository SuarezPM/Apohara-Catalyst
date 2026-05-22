/**
 * Trust presets per spec §4.5 (orca #2 inspiration —
 * `reference/orca/src/main/agent-trust-presets.ts:1-133`).
 *
 * Pre-write provider-native "I trust this folder" config so the CLI doesn't
 * pop an interactive trust dialog that breaks bracketed-paste and stdio flow.
 *
 * Supported targets:
 *   claude   → `~/.claude/settings.json` (`trustedFolders` array)
 *   codex    → `~/.codex/config.toml` (`[projects."<path>"] trust_level`)
 *   cursor   → `~/.cursor/projects/<slug>/.workspace-trusted`
 *   copilot  → `~/.copilot/config.json` (`trustedFolders` array)
 *   aider    → `~/.aider/projects.json` (per-project allow flag)
 *
 * The trust-file paths and shapes mirror what each CLI writes ITSELF after
 * the user accepts the trust prompt — so pre-writing produces the same
 * effect without the modal dialog ever appearing.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { homedir as getRealHome } from "node:os";
import { join, dirname } from "node:path";
import { atomicWriteFile, atomicWriteJson } from "../persistence/atomicWrite";
import { getAgentConfig, type ProviderId } from "./agent-config";

function userHomeDir(): string {
	return process.env.HOME ?? getRealHome();
}

/**
 * Macs report `/tmp/x` and `/private/tmp/x` as the same inode, and several
 * CLIs (cursor, copilot) run realpath() before the trust-path comparison.
 * Mirror that here so a worktree under a symlinked parent matches.
 */
function canonicalize(p: string): string {
	try {
		if (existsSync(p)) return realpathSync(p);
	} catch {
		/* fall through */
	}
	return p;
}

export type TrustTarget = "claude" | "codex" | "cursor" | "copilot" | "aider";

export async function applyTrustForProvider(
	providerId: ProviderId,
	workspacePath: string,
): Promise<void> {
	const cfg = getAgentConfig(providerId);
	if (!cfg || !cfg.preflightTrust) return;
	await applyTrust(cfg.preflightTrust, workspacePath);
}

export async function applyTrust(
	target: TrustTarget,
	workspacePath: string,
): Promise<void> {
	const absPath = canonicalize(workspacePath);
	switch (target) {
		case "claude":
			await writeClaudeTrust(absPath);
			break;
		case "codex":
			await writeCodexTrust(absPath);
			break;
		case "cursor":
			await writeCursorTrust(absPath);
			break;
		case "copilot":
			await writeCopilotTrust(absPath);
			break;
		case "aider":
			await writeAiderTrust(absPath);
			break;
	}
}

async function writeClaudeTrust(workspacePath: string): Promise<void> {
	const settingsPath = join(userHomeDir(), ".claude", "settings.json");
	await mkdir(dirname(settingsPath), { recursive: true });

	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(await readFile(settingsPath, "utf-8"));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
	}

	const trusted = (settings.trustedFolders as string[] | undefined) ?? [];
	if (!trusted.includes(workspacePath)) {
		trusted.push(workspacePath);
		settings.trustedFolders = trusted;
		await atomicWriteJson(settingsPath, settings);
	}
}

async function writeCodexTrust(workspacePath: string): Promise<void> {
	const configPath = join(userHomeDir(), ".codex", "config.toml");
	await mkdir(dirname(configPath), { recursive: true });

	let existing = "";
	try {
		existing = await readFile(configPath, "utf-8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
	}

	const blockHeader = `[projects.${JSON.stringify(workspacePath)}]`;
	if (existing.includes(blockHeader)) return;
	const block = `\n${blockHeader}\ntrust_level = "trusted"\n`;
	await atomicWriteFile(configPath, existing + block);
}

/**
 * Cursor: `~/.cursor/projects/<slug>/.workspace-trusted`. The slug is the
 * absolute path with the leading `/` stripped and remaining slashes
 * replaced with `-` (verified against the cursor-agent CLI bundle).
 */
async function writeCursorTrust(workspacePath: string): Promise<void> {
	const slug = workspacePath.replace(/^[\\/]+/, "").replace(/[\\/]+/g, "-");
	if (!slug) return;
	const trustDir = join(userHomeDir(), ".cursor", "projects", slug);
	const trustFile = join(trustDir, ".workspace-trusted");
	await mkdir(trustDir, { recursive: true });
	const payload = {
		trustedAt: new Date().toISOString(),
		workspacePath,
	};
	await atomicWriteJson(trustFile, payload);
}

/**
 * Copilot CLI: `~/.copilot/config.json::trustedFolders` array.
 */
async function writeCopilotTrust(workspacePath: string): Promise<void> {
	const configDir = join(userHomeDir(), ".copilot");
	const configPath = join(configDir, "config.json");
	await mkdir(configDir, { recursive: true });

	let config: Record<string, unknown> = {};
	try {
		const raw = existsSync(configPath)
			? readFileSync(configPath, "utf-8")
			: "";
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				config = parsed as Record<string, unknown>;
			}
		}
	} catch {
		// Corrupted config — refuse to overwrite (matches orca's behavior).
		return;
	}

	const existing = Array.isArray(config.trustedFolders)
		? (config.trustedFolders as unknown[]).filter(
				(e): e is string => typeof e === "string",
			)
		: [];
	const normalized = existing.map((e) => canonicalize(e));
	if (normalized.includes(workspacePath)) return;
	config.trustedFolders = [...existing, workspacePath];
	await atomicWriteJson(configPath, config);
}

/**
 * Aider: `~/.aider/projects.json::{<absPath>: {auto_confirm: true}}`. The
 * exact key is `auto_confirm` per the aider CLI's `aider/onboarding.py`.
 * If aider isn't installed the file is harmless and ignored.
 */
async function writeAiderTrust(workspacePath: string): Promise<void> {
	const configDir = join(userHomeDir(), ".aider");
	const configPath = join(configDir, "projects.json");
	await mkdir(configDir, { recursive: true });

	let projects: Record<string, { auto_confirm?: boolean }> = {};
	try {
		const raw = await readFile(configPath, "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			projects = parsed as typeof projects;
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") return;
	}

	if (projects[workspacePath]?.auto_confirm === true) return;
	projects[workspacePath] = {
		...(projects[workspacePath] ?? {}),
		auto_confirm: true,
	};
	await atomicWriteJson(configPath, projects);
}
