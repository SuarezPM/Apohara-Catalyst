import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	validateAllChanges,
	validateChange,
} from "../../../src/core/openspec/validator";

let tmp: string;

beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "apohara-openspec-test-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true, force: true });
});

async function plantChange(
	slug: string,
	files: Record<string, string>,
): Promise<string> {
	const dir = join(tmp, "changes", slug);
	for (const [rel, body] of Object.entries(files)) {
		const path = join(dir, rel);
		await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
		await writeFile(path, body);
	}
	return dir;
}

test("validateChange passes for a well-formed proposal", async () => {
	const dir = await plantChange("2026-05-22-test-change", {
		"proposal.md": "# proposal\nstatus draft",
		"design.md": "# design",
		"tasks.md": "# tasks\n- [ ] T-1 do the thing",
		"specs/cap/spec.md":
			"# cap\n\n## ADDED Requirements\n\n### Requirement: foo\nshall do x",
	});
	const report = await validateChange(dir);
	expect(report.ok).toBe(true);
	expect(report.issues).toEqual([]);
});

test("validateChange flags missing required files as errors", async () => {
	const dir = await plantChange("missing", {
		"design.md": "# design",
	});
	const report = await validateChange(dir);
	expect(report.ok).toBe(false);
	const errors = report.issues.filter((i) => i.severity === "error");
	expect(errors.some((i) => i.message.includes("proposal.md"))).toBe(true);
	expect(errors.some((i) => i.message.includes("tasks.md"))).toBe(true);
});

test("validateChange warns on tasks.md with no `- [ ]` lines", async () => {
	const dir = await plantChange("empty-tasks", {
		"proposal.md": "# proposal",
		"design.md": "# design",
		"tasks.md": "# tasks\njust a paragraph, no boxes",
	});
	const report = await validateChange(dir);
	const warnings = report.issues.filter((i) => i.severity === "warning");
	expect(warnings.some((i) => i.message.includes("no `- [ ]`"))).toBe(true);
});

test("validateChange errors on spec.md missing Requirements header", async () => {
	const dir = await plantChange("bad-spec", {
		"proposal.md": "# proposal",
		"design.md": "# design",
		"tasks.md": "- [ ] T-1",
		"specs/cap/spec.md": "# cap\n\njust prose, no headers",
	});
	const report = await validateChange(dir);
	expect(report.ok).toBe(false);
	const errors = report.issues.filter((i) => i.severity === "error");
	expect(
		errors.some((i) =>
			i.message.includes("ADDED|MODIFIED|REMOVED|RENAMED Requirements"),
		),
	).toBe(true);
});

test("validateAllChanges skips the archive/ dir", async () => {
	await plantChange("2026-05-22-active", {
		"proposal.md": "# p",
		"design.md": "# d",
		"tasks.md": "- [ ] T",
	});
	await plantChange("archive/2026-04-01-done", {
		"proposal.md": "# old",
		"tasks.md": "- [x] T",
	});
	const reports = await validateAllChanges(tmp);
	expect(reports.map((r) => r.slug)).toEqual(["2026-05-22-active"]);
});
