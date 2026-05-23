import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function estimateWorktreeSize(path: string): Promise<number> {
  let total = 0;
  const stack: string[] = [path];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const s = await stat(full);
          total += s.size;
        } catch {
          // race with deletion is fine
        }
      }
    }
  }
  return total;
}
