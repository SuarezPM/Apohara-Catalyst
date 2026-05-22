/**
 * Spec §6.1 / Task 10.5: `parsePlanDocument` must propagate the `## Out of Scope`
 * section into `PlanDocument.outOfScope` as an array of bullet strings, and
 * leave it `undefined` when the section is missing or has zero bullets.
 *
 * Drift documented: the original Task 10.1 fixture used `## Goal` / `## Tasks`
 * and no YAML frontmatter, which the current parser rejects. This task rewrites
 * the fixture to the parser's actual schema (frontmatter + `## Objective` +
 * `## Acceptance Criteria` + `## Out of Scope`) while preserving the same three
 * Out of Scope items.
 *
 * Parser-bullet-syntax drift: `parseBulletList` matches only `^\s*-\s+…` —
 * i.e. dash bullets. Asterisk (`*`) bullets are NOT recognised. The whitespace
 * tolerance test exercises leading/trailing whitespace around dash bullets, and
 * documents/asserts that `*` bullets are ignored.
 */
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parsePlanDocument } from "../../src/core/spec/planDocuments";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const SAMPLE_PLAN = resolve(
	REPO_ROOT,
	"tests/fixtures/sample-monorepo/docs/plans/sample-plan.md",
);

function mkTmp(): string {
	return mkdtempSync(join(tmpdir(), "apohara-spec-"));
}

function writePlan(dir: string, body: string, name = "plan.md"): string {
	const fp = join(dir, name);
	writeFileSync(fp, body, "utf-8");
	return fp;
}

const FRONTMATTER = [
	"---",
	"title: Tmp Plan",
	"status: draft",
	"---",
	"",
	"## Objective",
	"Some objective so the parser does not throw.",
	"",
].join("\n");

test("happy path: parses Out of Scope from committed fixture", async () => {
	const doc = await parsePlanDocument(SAMPLE_PLAN);

	expect(doc.outOfScope).toBeDefined();
	expect(doc.outOfScope).toEqual([
		"no authentication for `users` endpoint",
		"no password reset flow",
		"no admin console",
	]);
});

test("no Out-of-Scope section → outOfScope is undefined", async () => {
	const dir = mkTmp();
	try {
		const fp = writePlan(
			dir,
			FRONTMATTER +
				"\n## Acceptance Criteria\n- [ ] Do the thing\n",
		);
		const doc = await parsePlanDocument(fp);
		expect(doc.outOfScope).toBeUndefined();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("multi-line bullets: each bullet captured as a separate entry", async () => {
	const dir = mkTmp();
	try {
		const fp = writePlan(
			dir,
			FRONTMATTER +
				[
					"",
					"## Out of Scope",
					"- the multi word phrase that goes on",
					"- another bullet with `code` in it",
					"- third item — em dash and unicode ✨",
					"- fourth item, plain prose",
					"- fifth and final item with trailing words",
					"",
				].join("\n"),
		);
		const doc = await parsePlanDocument(fp);

		expect(doc.outOfScope).toBeDefined();
		expect(doc.outOfScope).toHaveLength(5);
		expect(doc.outOfScope).toEqual([
			"the multi word phrase that goes on",
			"another bullet with `code` in it",
			"third item — em dash and unicode ✨",
			"fourth item, plain prose",
			"fifth and final item with trailing words",
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("empty section: Out of Scope heading with no bullets → undefined", async () => {
	const dir = mkTmp();
	try {
		const fp = writePlan(
			dir,
			FRONTMATTER +
				"\n## Out of Scope\n\n## Context\nSome trailing context.\n",
		);
		const doc = await parsePlanDocument(fp);
		expect(doc.outOfScope).toBeUndefined();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("whitespace tolerance: trims; `*` bullets are NOT recognised (dash-only)", async () => {
	const dir = mkTmp();
	try {
		const fp = writePlan(
			dir,
			FRONTMATTER +
				[
					"",
					"## Out of Scope",
					"-    leading whitespace bullet   ",
					"  -   indented dash bullet   ",
					"* asterisk bullet that should be ignored",
					"-\tnormal bullet after a tab gap",
					"",
				].join("\n"),
		);
		const doc = await parsePlanDocument(fp);

		expect(doc.outOfScope).toBeDefined();
		// Dash bullets only; `*` line skipped by parseBulletList regex.
		expect(doc.outOfScope).toEqual([
			"leading whitespace bullet",
			"indented dash bullet",
			"normal bullet after a tab gap",
		]);
		expect(doc.outOfScope).not.toContain(
			"asterisk bullet that should be ignored",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
