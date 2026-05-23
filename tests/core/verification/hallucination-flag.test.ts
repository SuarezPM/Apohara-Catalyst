import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectHallucinations } from "../../../src/core/verification/hallucinationFlag";

function ws(): string {
  return mkdtempSync(join(tmpdir(), "apohara-hallucination-"));
}

test("flags imports of nonexistent modules", () => {
  const workspace = ws();
  writeFileSync(join(workspace, "real-module.ts"), "export const real = 1;");
  const result = detectHallucinations({
    code: `import { foo } from "./nonexistent";\nimport { real } from "./real-module";`,
    existingFiles: [join(workspace, "real-module.ts")],
    workspacePath: workspace,
  });
  expect(result.hallucinations).toContain("./nonexistent");
  expect(result.hallucinations).not.toContain("./real-module");
});

test("flags references to undefined function names", () => {
  const result = detectHallucinations({
    code: `someUndefinedHelper();`,
    existingFiles: [],
    workspacePath: "/x",
    definedSymbols: new Set(["console", "process"]),
  });
  expect(result.hallucinations.length).toBeGreaterThan(0);
  expect(result.hallucinations).toContain("someUndefinedHelper");
});

test("clean code returns empty hallucinations", () => {
  const result = detectHallucinations({
    code: `console.log("ok");`,
    existingFiles: [],
    workspacePath: "/x",
    definedSymbols: new Set(["console"]),
  });
  expect(result.hallucinations).toEqual([]);
});

test("does not flag import/require keywords as undefined symbols", () => {
  const result = detectHallucinations({
    code: `import("./mod"); require("./mod2");`,
    existingFiles: [],
    workspacePath: "/x",
    definedSymbols: new Set([]),
  });
  // import/require are syntax, not symbol calls
  expect(result.hallucinations).not.toContain("import");
  expect(result.hallucinations).not.toContain("require");
});

test("resolves relative import to .ts extension", () => {
  const workspace = ws();
  writeFileSync(join(workspace, "mod.ts"), "");
  const result = detectHallucinations({
    code: `import { x } from "./mod";`,
    existingFiles: [],
    workspacePath: workspace,
  });
  expect(result.hallucinations).not.toContain("./mod");
});

test("resolves relative import to index.ts in folder", () => {
  const workspace = ws();
  mkdirSync(join(workspace, "pkg"), { recursive: true });
  writeFileSync(join(workspace, "pkg", "index.ts"), "");
  const result = detectHallucinations({
    code: `import { x } from "./pkg";`,
    existingFiles: [],
    workspacePath: workspace,
  });
  expect(result.hallucinations).not.toContain("./pkg");
});

test("does not check symbol calls when definedSymbols undefined", () => {
  const result = detectHallucinations({
    code: `randomThing();`,
    existingFiles: [],
    workspacePath: "/x",
  });
  expect(result.hallucinations).toEqual([]);
});
