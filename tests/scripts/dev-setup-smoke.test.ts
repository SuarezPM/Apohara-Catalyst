/**
 * G5.F.5 — dev-setup.sh smoke test.
 *
 * The script must be valid bash and present the expected sections. We
 * do not run it end-to-end in CI (it would re-install workspace deps),
 * but we DO assert structural invariants: syntax-check via `bash -n`,
 * presence of every step header, and the toolchain-required commands.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../../scripts/dev-setup.sh");

describe("G5.F.5 — dev-setup.sh", () => {
	test("passes `bash -n` syntax check", () => {
		const r = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf-8" });
		expect(r.status).toBe(0);
		expect(r.stderr).toBe("");
	});

	test("declares all required toolchain dependencies", async () => {
		const body = await readFile(SCRIPT, "utf-8");
		expect(body).toContain("require bun");
		expect(body).toContain("require cargo");
		expect(body).toContain("require git");
	});

	test("contains the 6 step sections", async () => {
		const body = await readFile(SCRIPT, "utf-8");
		// Numbered headings in the script — keep in sync with steps.
		expect(body).toMatch(/--- 1\. toolchain check/);
		expect(body).toMatch(/--- 2\. bun install/);
		expect(body).toMatch(/--- 3\. desktop react symlink/);
		expect(body).toMatch(/--- 4\. cargo build/);
		expect(body).toMatch(/--- 5\. ts-rs bindings/);
		expect(body).toMatch(/--- 6\. doctor/);
	});

	test("is executable", async () => {
		const { stat } = await import("node:fs/promises");
		const s = await stat(SCRIPT);
		// owner-exec bit
		expect((s.mode & 0o100) !== 0).toBe(true);
	});
});
