import { expect, test } from "bun:test";
import { execSync } from "child_process";

const PATTERNS = [
  "sk-ant-[a-zA-Z0-9_-]{32,}",
  "sk-proj-[a-zA-Z0-9_-]{32,}",
  "AKIA[A-Z0-9]{16,}",
  "ghp_[a-zA-Z0-9]{36,}",
  "gho_[a-zA-Z0-9]{36,}",
  "ya29\\.",
];

const RG_PATTERN = PATTERNS.map(p => `-e '${p}'`).join(" ");

test("built bundles have no hardcoded secrets", () => {
  const cmd = `rg --hidden ${RG_PATTERN} dist/ packages/desktop/dist/ npx-cli/dist/ 2>/dev/null | grep -v 'no-secrets-in-build' || true`;
  const result = execSync(cmd, { encoding: "utf-8", shell: "/bin/bash" }).trim();
  expect(result).toBe("");
});

test("source tree has no committed secrets", () => {
  const cmd = `rg --hidden ${RG_PATTERN} src/ packages/ crates/ 2>/dev/null | grep -v 'no-secrets-in-build\\|test\\|fixture\\|mock' || true`;
  const result = execSync(cmd, { encoding: "utf-8", shell: "/bin/bash" }).trim();
  expect(result).toBe("");
});
