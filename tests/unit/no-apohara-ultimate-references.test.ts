import { expect, test } from "bun:test";
import { execSync } from "child_process";

test("source tree no longer mentions 'Apohara Ultimate'", () => {
  // Allow markdown to keep historical references (CHANGELOG, docs, plans).
  // Exclude .md, .lock, and the test file itself.
  const hits = execSync(
    "rg -l 'Apohara Ultimate' --type-not md --type-not lock 2>/dev/null | grep -v 'tests/unit/no-apohara-ultimate-references.test.ts' || true",
    { encoding: "utf-8", shell: "/bin/bash" }
  ).trim();
  expect(hits).toBe("");
});
