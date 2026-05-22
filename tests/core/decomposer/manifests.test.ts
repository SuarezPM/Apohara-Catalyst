import { test, expect } from "bun:test";
import { parseTaskWithManifest, validateManifest, type RawTask } from "../../../src/core/decomposer/manifests";

test("parses well-formed task with manifest", () => {
  const raw: RawTask = {
    id: "t-1",
    description: "refactor login",
    dependsOn: [],
    agentRole: "coder",
    symbols: {
      reads: [{ file: "src/auth.ts", symbol: "verify", kind: "function" }],
      writes: [{ file: "src/api/login.ts", symbol: "loginHandler", kind: "function" }],
      renames: [],
    },
  };
  const parsed = parseTaskWithManifest(raw);
  expect(parsed.id).toBe("t-1");
  expect(parsed.symbols.writes.length).toBe(1);
});

test("validateManifest accepts well-formed input", () => {
  const result = validateManifest({
    reads: [{ file: "a.ts", symbol: "foo", kind: "function" }],
    writes: [],
    renames: [],
  });
  expect(result.ok).toBe(true);
});

test("validateManifest rejects missing reads array", () => {
  const result = validateManifest({ writes: [], renames: [] } as unknown);
  expect(result.ok).toBe(false);
});