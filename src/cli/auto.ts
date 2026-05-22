/**
 * `apohara auto --spec <path>` CLI command per spec §6.4.
 *
 * Loads a plan via parsePlanDocument, validates not paused, builds an
 * ObjectivePayload for the orchestration runtime. Appends agent session
 * refs to the plan's auto-managed block on completion.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parsePlanDocument, type PlanDocument, type ChecklistItem } from "../core/spec/planDocuments";
import { EXIT_USER_ERROR } from "../core/cli/output";

export interface ObjectivePayload {
	planId: string;
	title: string;
	objective: string;
	acceptanceCriteria: ChecklistItem[];
	context?: string;
	outOfScope?: string[];
	priority?: string;
	agentRole?: string;
}

export interface AgentSessionAppend {
	sessionId: string;
	startedAt: number;
	endedAt?: number;
	outcome?: "success" | "failure" | "in_progress";
}

export interface AutoCommandOpts {
	specPath: string;
	appendSession?: AgentSessionAppend;
}

export interface AutoResult {
	exitCode: number;
	payload?: ObjectivePayload;
	error?: { code: string; message: string };
}

const BLOCK_START = "<!-- apohara:agentSessions:start -->";
const BLOCK_END = "<!-- apohara:agentSessions:end -->";

export async function runAutoCommand(opts: AutoCommandOpts): Promise<AutoResult> {
	let plan: PlanDocument;
	try {
		plan = await parsePlanDocument(opts.specPath);
	} catch (e) {
		return {
			exitCode: EXIT_USER_ERROR,
			error: { code: "SPEC_PARSE_ERROR", message: (e as Error).message },
		};
	}

	if (plan.status === "paused") {
		return {
			exitCode: EXIT_USER_ERROR,
			error: { code: "SPEC_PAUSED", message: `plan ${plan.planId} is paused; resume via status: active` },
		};
	}

	const payload: ObjectivePayload = {
		planId: plan.planId,
		title: plan.title,
		objective: plan.objective,
		acceptanceCriteria: plan.acceptanceCriteria,
		context: plan.context,
		outOfScope: plan.outOfScope,
		priority: plan.priority,
	};

	if (opts.appendSession) {
		await appendSessionToPlan(opts.specPath, opts.appendSession);
	}

	return { exitCode: 0, payload };
}

async function appendSessionToPlan(filepath: string, session: AgentSessionAppend): Promise<void> {
	const raw = await readFile(filepath, "utf-8");

	const block =
		`\n${BLOCK_START}\n` +
		`- sessionId: ${session.sessionId}\n` +
		`  startedAt: ${session.startedAt}\n` +
		(session.endedAt ? `  endedAt: ${session.endedAt}\n` : "") +
		(session.outcome ? `  outcome: ${session.outcome}\n` : "") +
		`${BLOCK_END}\n`;

	const startIdx = raw.indexOf(BLOCK_START);
	const endIdx = raw.indexOf(BLOCK_END);

	let updated: string;
	if (startIdx !== -1 && endIdx !== -1) {
		const before = raw.slice(0, startIdx);
		const after = raw.slice(endIdx + BLOCK_END.length);
		const existing = raw.slice(startIdx + BLOCK_START.length, endIdx);
		const newBlock =
			`${BLOCK_START}${existing}` +
			`- sessionId: ${session.sessionId}\n` +
			`  startedAt: ${session.startedAt}\n` +
			(session.endedAt ? `  endedAt: ${session.endedAt}\n` : "") +
			(session.outcome ? `  outcome: ${session.outcome}\n` : "") +
			`${BLOCK_END}`;
		updated = before + newBlock + after;
	} else {
		updated = raw + block;
	}

	await writeFile(filepath, updated);
}