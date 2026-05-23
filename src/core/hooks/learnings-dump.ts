/**
 * Learnings dump — G5.C.5 (claude-octopus #9).
 *
 * At session-end the agent surfaces a structured summary of what it learned:
 *
 *   - discoveries: facts about the codebase that surprised us
 *   - decisions:   choices made and the *why*
 *   - incidents:   bugs hit, surprising failures, hard-earned rules
 *   - conventions: project-wide patterns noted (anti-patterns or norms)
 *   - nextSteps:   pending work / follow-ups for the next session
 *
 * The dump is written atomically (§0.8) to disk so the next session can
 * read it on startup and inject it as `additionalContext`. Also exposes
 * an in-memory `renderAdditionalContext()` for callers that prefer to
 * pass the envelope directly without a roundtrip through disk.
 *
 * This collector is owned by the session orchestrator and lives for the
 * duration of one run. Multiple instances are fine — they don't share
 * state.
 */
import { atomicWriteJson } from "../persistence/atomicWrite.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export type LearningCategory =
	| "discoveries"
	| "decisions"
	| "incidents"
	| "conventions"
	| "nextSteps";

export interface LearningEntry {
	category: LearningCategory;
	title: string;
	detail: string;
}

export interface LearningsSnapshot {
	discoveries: LearningEntry[];
	decisions: LearningEntry[];
	incidents: LearningEntry[];
	conventions: LearningEntry[];
	nextSteps: LearningEntry[];
}

export interface DumpOptions {
	sessionId: string;
	dir: string;
	finishedAt: number;
	objective: string;
}

export type LearningsHookEvent =
	| {
			type: "session_stop";
			sessionId: string;
			reason: "completed" | "interrupted" | "crashed";
			timestamp: number;
	  }
	| {
			type: "session_learning";
			category: LearningCategory;
			title: string;
			detail: string;
			timestamp: number;
	  };

export interface HookOutcome {
	action: "recorded" | "ignored";
}

const CATEGORY_ORDER: LearningCategory[] = [
	"discoveries",
	"decisions",
	"incidents",
	"conventions",
	"nextSteps",
];

const CATEGORY_HEADER: Record<LearningCategory, string> = {
	discoveries: "Discoveries",
	decisions: "Decisions",
	incidents: "Incidents",
	conventions: "Conventions",
	nextSteps: "Next steps",
};

export class LearningsCollector {
	private entries: LearningsSnapshot = {
		discoveries: [],
		decisions: [],
		incidents: [],
		conventions: [],
		nextSteps: [],
	};

	add(entry: LearningEntry): void {
		this.entries[entry.category].push({
			category: entry.category,
			title: entry.title,
			detail: entry.detail,
		});
	}

	snapshot(): LearningsSnapshot {
		// Shallow clone — callers must not mutate.
		return {
			discoveries: [...this.entries.discoveries],
			decisions: [...this.entries.decisions],
			incidents: [...this.entries.incidents],
			conventions: [...this.entries.conventions],
			nextSteps: [...this.entries.nextSteps],
		};
	}

	async dump(opts: DumpOptions): Promise<string> {
		await mkdir(opts.dir, { recursive: true });
		const file = join(opts.dir, `learnings-${opts.sessionId}.json`);
		const body = {
			sessionId: opts.sessionId,
			objective: opts.objective,
			finishedAt: opts.finishedAt,
			learnings: this.snapshot(),
		};
		await atomicWriteJson(file, body, { ensureParentDir: true });
		return file;
	}

	renderAdditionalContext(): { additionalContext: string } {
		const lines: string[] = [];
		let any = false;
		for (const cat of CATEGORY_ORDER) {
			const list = this.entries[cat];
			if (list.length === 0) continue;
			any = true;
			lines.push(`### ${CATEGORY_HEADER[cat]}`);
			for (const e of list) {
				lines.push(`- ${e.title}: ${e.detail}`);
			}
			lines.push("");
		}
		return { additionalContext: any ? lines.join("\n").trimEnd() : "" };
	}

	onHookEvent(event: LearningsHookEvent): HookOutcome {
		if (event.type === "session_stop") {
			this.add({
				category: "nextSteps",
				title: `session ended (${event.reason})`,
				detail: `at ${new Date(event.timestamp).toISOString()}`,
			});
			return { action: "recorded" };
		}
		if (event.type === "session_learning") {
			this.add({
				category: event.category,
				title: event.title,
				detail: event.detail,
			});
			return { action: "recorded" };
		}
		return { action: "ignored" };
	}
}
