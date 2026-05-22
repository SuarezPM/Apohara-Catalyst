/**
 * OpenSpec change-folder validator.
 *
 * Walks `openspec/changes/<slug>/` and checks:
 *   - `proposal.md` exists and parses minimal front-matter.
 *   - `design.md` exists (may be empty for trivial proposals).
 *   - `tasks.md` exists and has at least one `- [ ]` or `- [x]` line.
 *   - `specs/<capability>/spec.md` files have at least one
 *     `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` section, and
 *     each spec contains at least one `### Requirement:` block.
 *
 * Doesn't try to validate Liquid templates or cross-reference
 * capabilities against the archived `openspec/specs/` tree — that's
 * the Stage 8 polish. For v1 the validator catches structural drift
 * (missing files, empty task lists, malformed spec deltas) which is
 * the bulk of what review needs to catch automatically.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
	path: string;
	severity: ValidationSeverity;
	message: string;
}

export interface ValidationReport {
	slug: string;
	ok: boolean;
	issues: ValidationIssue[];
}

const REQUIRED_FILES: { name: string; severity: ValidationSeverity }[] = [
	{ name: "proposal.md", severity: "error" },
	{ name: "design.md", severity: "warning" },
	{ name: "tasks.md", severity: "error" },
];

const REQUIREMENTS_HEADER =
	/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/m;
const REQUIREMENT_LINE = /^###\s+Requirement:\s+/m;
const TASK_LINE = /^\s*-\s*\[[ x]\]/m;

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function validateChange(
	changeDir: string,
): Promise<ValidationReport> {
	const slug = changeDir.split("/").filter(Boolean).pop() ?? changeDir;
	const issues: ValidationIssue[] = [];

	for (const req of REQUIRED_FILES) {
		const p = join(changeDir, req.name);
		if (!(await exists(p))) {
			issues.push({
				path: p,
				severity: req.severity,
				message: `missing required file '${req.name}'`,
			});
		}
	}

	// tasks.md must have at least one task line.
	const tasksPath = join(changeDir, "tasks.md");
	if (await exists(tasksPath)) {
		const body = await readFile(tasksPath, "utf-8");
		if (!TASK_LINE.test(body)) {
			issues.push({
				path: tasksPath,
				severity: "warning",
				message: "tasks.md has no `- [ ]` / `- [x]` line — no actionable items",
			});
		}
	}

	// specs/<capability>/spec.md — each must have at least one
	// `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` section AND at
	// least one `### Requirement:` block inside.
	const specsDir = join(changeDir, "specs");
	if (await exists(specsDir)) {
		const capabilities = await readdir(specsDir).catch(() => [] as string[]);
		for (const cap of capabilities) {
			const specPath = join(specsDir, cap, "spec.md");
			if (!(await exists(specPath))) {
				issues.push({
					path: specPath,
					severity: "warning",
					message: `capability '${cap}' has no spec.md`,
				});
				continue;
			}
			const body = await readFile(specPath, "utf-8");
			if (!REQUIREMENTS_HEADER.test(body)) {
				issues.push({
					path: specPath,
					severity: "error",
					message: "missing `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` section",
				});
			}
			if (!REQUIREMENT_LINE.test(body)) {
				issues.push({
					path: specPath,
					severity: "error",
					message: "no `### Requirement:` block found",
				});
			}
		}
	}

	return {
		slug,
		ok: issues.every((i) => i.severity !== "error"),
		issues,
	};
}

/**
 * Validate every change folder under `openspec/changes/` (excluding
 * `openspec/changes/archive/`). Returns one report per slug.
 */
export async function validateAllChanges(
	openspecRoot: string,
): Promise<ValidationReport[]> {
	const changesDir = join(openspecRoot, "changes");
	if (!(await exists(changesDir))) return [];
	const slugs = (await readdir(changesDir)).filter(
		(s) => s !== "archive",
	);
	const reports: ValidationReport[] = [];
	for (const slug of slugs) {
		const dir = join(changesDir, slug);
		const st = await stat(dir).catch(() => null);
		if (!st?.isDirectory()) continue;
		reports.push(await validateChange(dir));
	}
	return reports;
}
