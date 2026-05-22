/**
 * Audit log writer.
 *
 * Properties:
 *   - `O_APPEND` is supplied via `open(..., "a")` so concurrent writers
 *     on POSIX serialize at the byte level for writes ≤ PIPE_BUF
 *     (which a single JSON line comfortably fits within).
 *   - Creation mode `0o600` so the audit file isn't world-readable even
 *     under a permissive umask. The fd-based `fchmod` removes the
 *     classic create-then-chmod TOCTOU window.
 *   - Each entry is `datasync`-ed before `log()` resolves so a crash
 *     after the caller observed the awaited promise can't lose the
 *     record that was nominally already committed.
 */
import { open, mkdir, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEntry {
	ts: number;
	server: string;
	tool: string;
	status: "ok" | "denied" | "error" | "rate_limited";
	detail?: string;
}

export class AuditLogger {
	private fh: FileHandle | null = null;
	private opening: Promise<FileHandle> | null = null;

	constructor(private path: string) {}

	private async handle(): Promise<FileHandle> {
		if (this.fh) return this.fh;
		if (this.opening) return this.opening;
		this.opening = (async () => {
			await mkdir(dirname(this.path), { recursive: true });
			const h = await open(this.path, "a", 0o600);
			// Belt-and-braces: enforce 0600 on the existing inode in case
			// the file pre-existed with a wider mode.
			await h.chmod(0o600).catch(() => {
				/* fchmod can fail on non-POSIX FS; the create mode above
				   is the primary defense. */
			});
			this.fh = h;
			return h;
		})();
		try {
			return await this.opening;
		} finally {
			this.opening = null;
		}
	}

	async log(entry: AuditEntry): Promise<void> {
		const h = await this.handle();
		const line = `${JSON.stringify(entry)}\n`;
		await h.write(line);
		await h.datasync();
	}

	async close(): Promise<void> {
		const h = this.fh;
		this.fh = null;
		await h?.close().catch(() => {});
	}
}
