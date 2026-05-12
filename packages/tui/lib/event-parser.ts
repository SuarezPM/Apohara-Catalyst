import type { EventLog } from "../../../src/core/types";

export const KNOWN_EVENT_TYPES = new Set([
	"auto_command_started",
	"auto_command_failed",
	"decomposition_completed",
	"auto_command_completed",
	"role_assignment",
	"provider_selected",
	"provider_fallback",
	"fallback_succeeded",
	"task_exhausted",
	"task_scheduled",
	"task_completed",
	"task_failed",
	"worktree_created",
	"worktree_creation_failed",
	"worktree_destroyed",
	"consolidation_started",
	"branch_created",
	"branch_creation_failed",
	"merge_conflict",
	"worktree_merged",
	"consolidation_completed",
	"lint_applied",
	"github_pr_created",
	"github_pr_skipped",
	"github_pr_error",
	"summary_generated",
	"fallback_cooldown",
	"cooldown_expired",
]);

export interface ParseResult {
	event: EventLog | null;
	malformed: boolean;
	unknownType: boolean;
}

export class EventParser {
	malformedLines = 0;
	unknownEventTypes = 0;

	parseLine(line: string): ParseResult {
		if (!line.trim()) {
			this.malformedLines++;
			return { event: null, malformed: true, unknownType: false };
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			this.malformedLines++;
			return { event: null, malformed: true, unknownType: false };
		}

		if (!this.isValidEventLog(parsed)) {
			this.malformedLines++;
			return { event: null, malformed: true, unknownType: false };
		}

		const event = parsed as EventLog;
		if (!KNOWN_EVENT_TYPES.has(event.type)) {
			this.unknownEventTypes++;
			return { event, malformed: false, unknownType: true };
		}

		return { event, malformed: false, unknownType: false };
	}

	private isValidEventLog(obj: unknown): obj is EventLog {
		if (typeof obj !== "object" || obj === null) return false;
		const e = obj as Record<string, unknown>;
		if (typeof e.id !== "string") return false;
		if (typeof e.timestamp !== "string") return false;
		if (typeof e.type !== "string") return false;
		if (typeof e.severity !== "string") return false;
		if (!["info", "warning", "error"].includes(e.severity)) return false;
		if (
			typeof e.payload !== "object" ||
			e.payload === null ||
			Array.isArray(e.payload)
		)
			return false;
		if (e.taskId !== undefined && typeof e.taskId !== "string") return false;
		if (
			e.metadata !== undefined &&
			(typeof e.metadata !== "object" ||
				e.metadata === null ||
				Array.isArray(e.metadata))
		)
			return false;
		return true;
	}
}
