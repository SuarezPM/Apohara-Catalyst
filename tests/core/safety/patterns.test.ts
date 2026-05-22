import { test, expect } from "bun:test";
import { matchPattern, type PermissionPattern, type ToolInvocation } from "../../../src/core/safety/patterns";

test("Bash(npm test:*) matches `npm test --watch`", () => {
  const p: PermissionPattern = { kind: "bash_prefix", prefix: "npm test" };
  const inv: ToolInvocation = { tool: "Bash", input: { command: "npm test --watch" } };
  expect(matchPattern(p, inv)).toBe(true);
});

test("Bash(npm test:*) does NOT match `npm install`", () => {
  const p: PermissionPattern = { kind: "bash_prefix", prefix: "npm test" };
  expect(matchPattern(p, { tool: "Bash", input: { command: "npm install" } })).toBe(false);
});

test("WebFetch(domain:github.com) matches https://api.github.com/...", () => {
  const p: PermissionPattern = { kind: "webfetch_domain", domain: "github.com" };
  expect(matchPattern(p, { tool: "WebFetch", input: { url: "https://api.github.com/user" } })).toBe(true);
});

test("Edit(src/**) matches src/api/users.ts", () => {
  const p: PermissionPattern = { kind: "edit_glob", glob: "src/**" };
  expect(matchPattern(p, { tool: "Edit", input: { file_path: "src/api/users.ts" } })).toBe(true);
});

test("Edit(*.env*) matches .env.local", () => {
  const p: PermissionPattern = { kind: "edit_glob", glob: "*.env*" };
  expect(matchPattern(p, { tool: "Edit", input: { file_path: ".env.local" } })).toBe(true);
});

test("mcp__apohara__* matches mcp__apohara__list_runs", () => {
  const p: PermissionPattern = { kind: "mcp_prefix", prefix: "mcp__apohara__" };
  expect(matchPattern(p, { tool: "mcp__apohara__list_runs", input: {} })).toBe(true);
});
