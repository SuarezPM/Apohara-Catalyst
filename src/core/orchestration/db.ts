/**
 * Orchestration DB per spec §3.6.
 *
 * bun:sqlite with WAL mode + 5s busy_timeout + foreign_keys ON.
 * Schema versioning via `PRAGMA user_version`. Migrations live in
 * `migrations/NNN_*.sql` — applied in order, idempotent via the
 * version pragma (CREATE TABLE IF NOT EXISTS is belt-and-braces).
 *
 * Subsequent tasks 2.9–2.11 add CRUD modules on top of this handle.
 */
import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface OrchestrationDb {
	raw(): Database;
	close(): void;
}

const SCHEMA_VERSION = 1;

export async function openOrchestrationDb(
	path: string,
): Promise<OrchestrationDb> {
	const db = new Database(path);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA busy_timeout = 5000");
	db.exec("PRAGMA foreign_keys = ON");

	const current = (
		db.query("PRAGMA user_version").get() as { user_version: number }
	).user_version;

	if (current < 1) {
		const sql = await readFile(
			join(import.meta.dir, "migrations", "001_initial.sql"),
			"utf-8",
		);
		db.exec(sql);
		db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
	}

	// Future migrations: chain `if (current < 2) { … migrations/002_*.sql … }`

	return {
		raw() {
			return db;
		},
		close() {
			db.close();
		},
	};
}
