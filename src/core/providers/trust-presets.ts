/**
 * Trust presets per spec §4.5 (orca #2 inspiration).
 *
 * Pre-write provider-native "I trust this folder" config so the CLI doesn't
 * pop an interactive trust dialog that breaks bracketed-paste and stdio flow.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir as getRealHome } from "node:os";
import { join, dirname } from "node:path";
import { atomicWriteJson } from "../persistence/atomicWrite";
import { getAgentConfig, type ProviderId } from "./agent-config";

function userHomeDir(): string {
  return process.env.HOME ?? getRealHome();
}

export async function applyTrustForProvider(providerId: ProviderId, workspacePath: string): Promise<void> {
  const cfg = getAgentConfig(providerId);
  if (!cfg || !cfg.preflightTrust) return;
  switch (cfg.preflightTrust) {
    case "claude":
      await writeClaudeTrust(workspacePath);
      break;
    case "codex":
      await writeCodexTrust(workspacePath);
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

  const blockHeader = `[projects."${workspacePath}"]`;
  if (existing.includes(blockHeader)) return;

  const block = `\n${blockHeader}\ntrust_level = "trusted"\n`;
  await writeFile(configPath, existing + block);
}