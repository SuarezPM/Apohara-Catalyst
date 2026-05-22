import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEntry {
  ts: number;
  server: string;
  tool: string;
  status: "ok" | "denied" | "error" | "rate_limited";
  detail?: string;
}

export class AuditLogger {
  constructor(private path: string) {}

  async log(entry: AuditEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(entry) + "\n");
  }
}
