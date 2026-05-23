/**
 * G8.A.5 — Regression guard.
 *
 * `APOHARA_MOCK_EMBEDDINGS` and the `mock-embeddings` cargo feature were the
 * Sprint-7 escape hatch that let CI / dev skip the ~400 MB Nomic BERT model
 * load. G8.A.1 swapped the indexer to sqlite-vec + blake3 feature hashing,
 * which is deterministic + in-process + zero RAM — so the escape hatch is
 * obsolete.
 *
 * These tests fail if the env var sneaks back into CI, package scripts, or
 * shell scripts (the surfaces this task owns). Rust source / docs / specs
 * are intentionally out of scope here — they are handled by sibling G8.A.*
 * tasks or kept as historical references.
 */
import { expect, test } from "bun:test";
import { execSync } from "child_process";

test("APOHARA_MOCK_EMBEDDINGS no longer referenced in CI / scripts / configs", () => {
	// Scope: CI workflows, root package.json, and any *.sh under scripts/.
	// Markdown (docs/plans) is allowed to keep historical references; lock
	// files are excluded because they cannot reintroduce the env var at
	// runtime.
	const hits = execSync(
		"rg -l 'APOHARA_MOCK_EMBEDDINGS' .github scripts package.json --type-not md --type-not lock 2>/dev/null | grep -v -E 'tests/unit/no-mock-embeddings-references.test.ts|node_modules' || true",
		{ encoding: "utf-8", shell: "/bin/bash" },
	).trim();
	expect(hits).toBe("");
});

test("mock-embeddings env-var prefix is gone from package.json scripts", () => {
	// Targeted check for the inline `APOHARA_MOCK_EMBEDDINGS=1 …` prefix in
	// the root package.json's scripts block. A broader rg over /src is out
	// of scope (Rust feature flag removal is handled by a sibling task).
	const hits = execSync(
		"rg -n 'APOHARA_MOCK_EMBEDDINGS' package.json 2>/dev/null || true",
		{ encoding: "utf-8", shell: "/bin/bash" },
	).trim();
	expect(hits).toBe("");
});
