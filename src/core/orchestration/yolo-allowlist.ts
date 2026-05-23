import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Per-workspace yolo allowlist — explicit opt-in file marker.
 * Empty file does NOT count as allowed (forces deliberate content).
 */
export async function isWorkspaceYoloAllowed(workspacePath: string): Promise<boolean> {
	try {
		const content = await readFile(join(workspacePath, ".apohara", "yolo-allowed"), "utf-8");
		return content.trim().length > 0;
	} catch {
		return false;
	}
}
