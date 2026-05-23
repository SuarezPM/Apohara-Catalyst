import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const idPath = () => join(process.env.HOME ?? homedir(), ".apohara", "install-id");

export async function getOrCreateInstallId(): Promise<string> {
  const path = idPath();
  try {
    const existing = await readFile(path, "utf-8");
    const trimmed = existing.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(trimmed)) {
      return trimmed;
    }
  } catch { /* fall through */ }
  const fresh = randomUUID();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, fresh, { mode: 0o600 });
  return fresh;
}
