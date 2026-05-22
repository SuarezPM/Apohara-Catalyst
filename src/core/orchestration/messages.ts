/**
 * messages table CRUD per spec §3.6.
 */
import type { OrchestrationDb } from "./db";

export type MessageType =
	| "status" | "dispatch" | "worker_done" | "merge_ready"
	| "escalation" | "handoff" | "decision_gate" | "heartbeat";

export type MessagePriority = "urgent" | "normal" | "low";

export interface SendMessageInput {
	fromHandle: string;
	toHandle: string;
	type: MessageType;
	subject?: string;
	body?: string;
	payload: unknown;
	priority?: MessagePriority;
	threadId?: string;
}

export interface MessageRow {
	id: number;
	fromHandle: string;
	toHandle: string;
	subject: string | null;
	body: string | null;
	type: MessageType;
	priority: MessagePriority;
	threadId: string | null;
	payload: unknown;
	read: number;
	deliveredAt: number | null;
	ts: number;
}

export function sendMessage(db: OrchestrationDb, input: SendMessageInput): number {
	const now = Date.now();
	const stmt = db.raw().prepare(`
		INSERT INTO messages
			(from_handle, to_handle, subject, body, type, priority, thread_id, payload, read, delivered_at, ts)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
	`);
	const info = stmt.run(
		input.fromHandle,
		input.toHandle,
		input.subject ?? null,
		input.body ?? null,
		input.type,
		input.priority ?? "normal",
		input.threadId ?? null,
		JSON.stringify(input.payload ?? null),
		now,
	);
	return Number(info.lastInsertRowid);
}

export interface ListUnreadOptions {
	types?: MessageType[];
	limit?: number;
}

function mapRow(r: {
	id: number;
	from_handle: string;
	to_handle: string;
	subject: string | null;
	body: string | null;
	type: MessageType;
	priority: MessagePriority;
	thread_id: string | null;
	payload: string;
	read: number;
	delivered_at: number | null;
	ts: number;
}): MessageRow {
	return {
		id: r.id,
		fromHandle: r.from_handle,
		toHandle: r.to_handle,
		subject: r.subject,
		body: r.body,
		type: r.type,
		priority: r.priority,
		threadId: r.thread_id,
		payload: r.payload ? JSON.parse(r.payload) : null,
		read: r.read,
		deliveredAt: r.delivered_at,
		ts: r.ts,
	};
}

export function listUnread(db: OrchestrationDb, toHandle: string, options: ListUnreadOptions = {}): MessageRow[] {
	let sql = `
		SELECT id, from_handle, to_handle, subject, body, type, priority, thread_id, payload, read, delivered_at, ts
		FROM messages
		WHERE to_handle = ? AND read = 0
	`;
	const params: unknown[] = [toHandle];

	if (options.types && options.types.length > 0) {
		const placeholders = options.types.map(() => "?").join(",");
		sql += ` AND type IN (${placeholders})`;
		params.push(...options.types);
	}

	sql += ` ORDER BY (CASE priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END) ASC, ts ASC`;

	if (options.limit && options.limit > 0) {
		// LIMIT bound rather than string-interpolated. bun:sqlite supports
		// bound LIMIT clauses and keeping every value parameterized is the
		// safest discipline even when the value is internally generated.
		sql += " LIMIT ?";
		params.push(options.limit);
	}

	const rows = db.raw().query(sql).all(...(params as never[])) as Array<{
		id: number;
		from_handle: string;
		to_handle: string;
		subject: string | null;
		body: string | null;
		type: MessageType;
		priority: MessagePriority;
		thread_id: string | null;
		payload: string;
		read: number;
		delivered_at: number | null;
		ts: number;
	}>;

	return rows.map(mapRow);
}

export function markRead(db: OrchestrationDb, id: number): void {
	db.raw().prepare(`UPDATE messages SET read = 1, delivered_at = ? WHERE id = ?`).run(Date.now(), id);
}

/**
 * Atomically claim the first matching unread message: read + mark-read
 * inside a single transaction so two concurrent consumers can't both
 * receive the same message. Returns `null` when no message matched.
 *
 * Replaces the old `listUnread + markRead` two-statement pattern that
 * the orchestration audit flagged as a claim race.
 */
export function claimNextUnread(
	db: OrchestrationDb,
	toHandle: string,
	options: ListUnreadOptions = {},
): MessageRow | null {
	const tx = db.raw().transaction(() => {
		const list = listUnread(db, toHandle, { ...options, limit: 1 });
		if (list.length === 0) return null;
		const msg = list[0];
		// Conditional update — guards against a parallel claimer beating
		// us to the mark even when the encompassing transaction is in WAL
		// mode (busy_timeout serializes writes but explicit guard makes
		// the contract self-evident).
		const info = db
			.raw()
			.prepare(
				`UPDATE messages SET read = 1, delivered_at = ? WHERE id = ? AND read = 0`,
			)
			.run(Date.now(), msg.id) as { changes: number };
		return info.changes > 0 ? msg : null;
	});
	return tx() as MessageRow | null;
}
