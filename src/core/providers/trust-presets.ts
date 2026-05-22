/**
 * Trust presets per spec §4.5 (orca #2 inspiration).
 *
 * Pre-write provider-native "I trust this folder" config so the CLI doesn't
 * pop an interactive trust dialog that breaks bracketed-paste and stdio flow.
 */
import { readFile, mkdir } from "node:fs/promises";
import { homedir as getRealHome } from "node:os";
import { join, dirname } from "node:path";
import { atomicWriteFile, atomicWriteJson } from "../persistence/atomicWrite";
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

  // Always use the TOML quoted-key form for the workspace path — paths
  // routinely contain dots, slashes and dashes that are invalid in bare
  // keys, and JSON.stringify gives us correct escape semantics.
  const blockHeader = `[projects.${JSON.stringify(workspacePath)}]`;
  if (existing.includes(blockHeader)) return;

  const block = `\n${blockHeader}\ntrust_level = "trusted"\n`;
  // §0.8 — atomic write to the user's codex config so a crash in the
  // middle of the append can't corrupt the existing trust list.
  await atomicWriteFile(configPath, existing + block);
}