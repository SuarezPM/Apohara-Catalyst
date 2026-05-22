/**
 * Stable install ID per spec §0.33.
 *
 * Generated once per home directory, reused in CLI + server. Format:
 * "inst_" + 16 random hex chars. Persisted at ~/.apohara/install_id.
 * If reading fails, generate a fresh one.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { atomicWriteFile } from "../persistence/atomicWrite";

const INSTALL_ID_PATH = join(homedir(), ".apohara", "install_id");

export async function getOrCreateInstallId(): Promise<string> {
  try {
    const existing = (await readFile(INSTALL_ID_PATH, "utf-8")).trim();
    if (/^inst_[0-9a-f]{16}$/.test(existing)) return existing;
  } catch {
    // fall through
  }
  const fresh = "inst_" + randomBytes(8).toString("hex");
  await atomicWriteFile(INSTALL_ID_PATH, fresh, { ensureParentDir: true });
  return fresh;
}
