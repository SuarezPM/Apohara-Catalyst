/**
 * Plan document parser per spec §6.1.
 *
 * Reads a markdown file with YAML frontmatter (delimited by ---) and
 * section headings (## Objective, ## Acceptance Criteria, etc.).
 *
 * Schema:
 *   - title: required string
 *   - status: required enum (draft|active|paused|done)
 *   - planType: optional enum (feature|bug|refactor|research)
 *   - priority: optional enum (urgent|high|normal|low)
 *   - owner, stakeholders, tags, created, updated, progress: optional
 *   - body sections: Objective (required), Acceptance Criteria, Out of Scope, Context
 *
 * planId = sha1(filepath + frontmatter.title) — deterministic for cache keys.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

export interface AgentSessionRef {
	sessionId: string;
	startedAt: number;
	endedAt?: number;
	outcome?: "success" | "failure" | "in_progress";
}

export interface ChecklistItem {
	checked: boolean;
	text: string;
}

export type PlanStatus = "draft" | "active" | "paused" | "done";
export type PlanType = "feature" | "bug" | "refactor" | "research";
export type PlanPriority = "urgent" | "high" | "normal" | "low";

export interface PlanDocument {
	planId: string;
	title: string;
	status: PlanStatus;
	planType?: PlanType;
	priority?: PlanPriority;
	owner?: string;
	stakeholders?: string[];
	tags?: string[];
	created?: string;
	updated?: string;
	progress?: number;
	agentSessions: AgentSessionRef[];
	objective: string;
	acceptanceCriteria: ChecklistItem[];
	outOfScope?: string[];
	context?: string;
}

const VALID_STATUSES: PlanStatus[] = ["draft", "active", "paused", "done"];
const VALID_TYPES: PlanType[] = ["feature", "bug", "refactor", "research"];
const VALID_PRIORITIES: PlanPriority[] = ["urgent", "high", "normal", "low"];

export async function parsePlanDocument(filepath: string): Promise<PlanDocument> {
	const raw = await readFile(filepath, "utf-8");

	// Split frontmatter
	if (!raw.startsWith("---\n")) {
		throw new Error(`plan ${filepath} missing YAML frontmatter (must start with ---)`);
	}
	const closingIdx = raw.indexOf("\n---\n", 4);
	if (closingIdx === -1) {
		throw new Error(`plan ${filepath} missing closing --- for frontmatter`);
	}
	const fmRaw = raw.slice(4, closingIdx);
	const body = raw.slice(closingIdx + 5);

	let fm: Record<string, unknown>;
	try {
		fm = (parseYaml(fmRaw) ?? {}) as Record<string, unknown>;
	} catch (e) {
		throw new Error(`plan ${filepath} has malformed YAML frontmatter: ${(e as Error).message}`);
	}

	if (typeof fm.title !== "string" || !fm.title.trim()) {
		throw new Error(`plan ${filepath} missing required field: title`);
	}
	if (typeof fm.status !== "string" || !VALID_STATUSES.includes(fm.status as PlanStatus)) {
		throw new Error(`plan ${filepath} status must be one of ${VALID_STATUSES.join("|")}, got: ${fm.status}`);
	}

	const planType = optionalEnum(fm.planType, VALID_TYPES, "planType", filepath);
	const priority = optionalEnum(fm.priority, VALID_PRIORITIES, "priority", filepath);

	// Body sections
	const sections = splitSections(body);
	const objective = (sections.get("Objective") ?? "").trim();
	if (!objective) {
		throw new Error(`plan ${filepath} missing required section: ## Objective`);
	}

	const acceptanceCriteria = parseChecklist(sections.get("Acceptance Criteria") ?? "");
	const outOfScope = parseBulletList(sections.get("Out of Scope") ?? "");
	const context = (sections.get("Context") ?? "").trim() || undefined;

	// planId = sha1(filepath + title)
	const planId = createHash("sha1")
		.update(filepath + (fm.title as string))
		.digest("hex");

	const plan: PlanDocument = {
		planId,
		title: (fm.title as string).trim(),
		status: fm.status as PlanStatus,
		planType,
		priority,
		owner: typeof fm.owner === "string" ? fm.owner : undefined,
		stakeholders: Array.isArray(fm.stakeholders)
			? (fm.stakeholders.filter((s) => typeof s === "string") as string[])
			: undefined,
		tags: Array.isArray(fm.tags) ? (fm.tags.filter((t) => typeof t === "string") as string[]) : undefined,
		created: typeof fm.created === "string" ? fm.created : undefined,
		updated: typeof fm.updated === "string" ? fm.updated : undefined,
		progress: typeof fm.progress === "number" ? fm.progress : undefined,
		agentSessions: [],
		objective,
		acceptanceCriteria,
		outOfScope: outOfScope.length > 0 ? outOfScope : undefined,
		context,
	};

	return plan;
}

function optionalEnum<T extends string>(
	value: unknown,
	allowed: T[],
	field: string,
	filepath: string,
): T | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(`plan ${filepath} ${field} must be one of ${allowed.join("|")}, got: ${value}`);
	}
	return value as T;
}

function splitSections(body: string): Map<string, string> {
	const out = new Map<string, string>();
	const lines = body.split("\n");
	let currentHeading: string | null = null;
	let currentBuffer: string[] = [];

	for (const line of lines) {
		const m = line.match(/^##\s+(.+?)\s*$/);
		if (m) {
			if (currentHeading) out.set(currentHeading, currentBuffer.join("\n"));
			currentHeading = m[1].trim();
			currentBuffer = [];
		} else if (currentHeading) {
			currentBuffer.push(line);
		}
	}
	if (currentHeading) out.set(currentHeading, currentBuffer.join("\n"));
	return out;
}

function parseChecklist(body: string): ChecklistItem[] {
	const items: ChecklistItem[] = [];
	for (const line of body.split("\n")) {
		const m = line.match(/^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/);
		if (m) {
			items.push({ checked: m[1].toLowerCase() === "x", text: m[2].trim() });
		}
	}
	return items;
}

function parseBulletList(body: string): string[] {
	const items: string[] = [];
	for (const line of body.split("\n")) {
		const m = line.match(/^\s*-\s+(.+?)\s*$/);
		if (m) items.push(m[1].trim());
	}
	return items;
}
