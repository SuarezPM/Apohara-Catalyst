/**
 * Group address resolver per spec §3.6.
 *
 * Group syntax (resolved at query time against `dispatch_contexts`):
 *   @all              all dispatches with status = 'running'
 *   @idle             running agents with no unread dispatch/escalation messages
 *   @worktree:<id>    running agents in worktree <id>
 *   @claude / @codex / @opencode / @<provider>   provider-scoped (LIKE 'agent:<provider>:%')
 *
 * Non-group handles (anything not starting with '@') pass through unchanged
 * so sendMessage callers can pipe through resolveGroup() unconditionally.
 *
 * Column names mirror the schema in migrations/001_initial.sql:
 *   dispatch_contexts(agent_handle, worktree_id, status)
 *   messages(to_handle, type, read)
 */
import type { OrchestrationDb } from "./db";

export function resolveGroup(db: OrchestrationDb, handle: string): string[] {
	if (!handle.startsWith("@")) return [handle];

	if (handle === "@all") {
		const rows = db
			.raw()
			.query(
				`SELECT DISTINCT agent_handle FROM dispatch_contexts WHERE status = 'running'`,
			)
			.all() as { agent_handle: string }[];
		return rows.map((r) => r.agent_handle);
	}

	if (handle === "@idle") {
		const rows = db
			.raw()
			.query(`
				SELECT DISTINCT dc.agent_handle
				FROM dispatch_contexts dc
				WHERE dc.status = 'running'
				  AND NOT EXISTS (
				    SELECT 1 FROM messages m
				    WHERE m.to_handle = dc.agent_handle
				      AND m.read = 0
				      AND m.type IN ('dispatch', 'escalation')
				  )
			`)
			.all() as { agent_handle: string }[];
		return rows.map((r) => r.agent_handle);
	}

	if (handle.startsWith("@worktree:")) {
		const wt = handle.slice("@worktree:".length);
		const rows = db
			.raw()
			.query(
				`SELECT DISTINCT agent_handle FROM dispatch_contexts WHERE worktree_id = ? AND status = 'running'`,
			)
			.all(wt) as { agent_handle: string }[];
		return rows.map((r) => r.agent_handle);
	}

	// @claude / @codex / @opencode / @<provider>
	const provider = handle.slice(1); // strip leading '@'
	const rows = db
		.raw()
		.query(
			`SELECT DISTINCT agent_handle FROM dispatch_contexts WHERE agent_handle LIKE ? AND status = 'running'`,
		)
		.all(`agent:${provider}:%`) as { agent_handle: string }[];
	return rows.map((r) => r.agent_handle);
}
