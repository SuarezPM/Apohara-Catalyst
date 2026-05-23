import { test, expect } from "bun:test";
import { check } from "../../../src/core/safety/permissionService";
import { PermissionCache } from "../../../src/core/safety/permissionCache";
import type { ToolInvocation } from "../../../src/core/safety/patterns";
import type { MergedSettings } from "../../../src/core/safety/settingsHierarchy";

const emptySettings: MergedSettings = { allow: [], deny: [] };

test("cache hit returns allow:cached", () => {
  const cache = new PermissionCache();
  cache.add("s1", "Bash(npm test:*)");
  const inv: ToolInvocation = { tool: "Bash", input: { command: "npm test --watch" } };
  const d = check("s1", inv, { cache, settings: emptySettings });
  expect(d.kind).toBe("allow");
  if (d.kind === "allow") expect(d.reason).toBe("cached");
});

test("settings allow returns allow:settings_allow", () => {
  // Use a command that is NOT in the auto-approval safe-list (G7.5.A.9
  // wiring): `npm` doesn't appear in `auto-approval.ts::SAFE_BASH_COMMANDS`,
  // so the decision must fall through to the settings allow-list match.
  const cache = new PermissionCache();
  const inv: ToolInvocation = { tool: "Bash", input: { command: "npm test" } };
  const d = check("s1", inv, { cache, settings: { allow: ["Bash(npm:*)"], deny: [] } });
  expect(d.kind).toBe("allow");
  if (d.kind === "allow") expect(d.reason).toBe("settings_allow");
});

test("settings deny wins over cache (deny checked first)", () => {
  const cache = new PermissionCache();
  // Even if user cached an allow, a deny rule must veto.
  cache.add("s1", "Bash(rm:*)");
  const inv: ToolInvocation = { tool: "Bash", input: { command: "rm -rf /" } };
  const d = check("s1", inv, { cache, settings: { allow: [], deny: ["Bash(rm:*)"] } });
  expect(d.kind).toBe("deny");
  if (d.kind === "deny") expect(d.reason).toBe("settings_deny");
});

test("compound bash forces scope=['once'] only (no escalation)", () => {
  const cache = new PermissionCache();
  const inv: ToolInvocation = {
    tool: "Bash",
    input: { command: "git status && rm -rf /" },
  };
  const d = check("s1", inv, { cache, settings: emptySettings });
  expect(d.kind).toBe("ask");
  if (d.kind === "ask") {
    expect(d.available_scopes).toEqual(["once"]);
  }
});

test("non-compound bash offers all three scopes", () => {
  const cache = new PermissionCache();
  const inv: ToolInvocation = { tool: "Bash", input: { command: "npm install" } };
  const d = check("s1", inv, { cache, settings: emptySettings });
  expect(d.kind).toBe("ask");
  if (d.kind === "ask") {
    expect(d.available_scopes).toEqual(["once", "session", "always"]);
    expect(d.suggested_pattern).toBe("Bash(npm:*)");
  }
});

test("suggested pattern for WebFetch uses domain", () => {
  const cache = new PermissionCache();
  const inv: ToolInvocation = {
    tool: "WebFetch",
    input: { url: "https://api.github.com/repos" },
  };
  const d = check("s1", inv, { cache, settings: emptySettings });
  expect(d.kind).toBe("ask");
  if (d.kind === "ask") {
    expect(d.suggested_pattern).toBe("WebFetch(domain:api.github.com)");
  }
});

test("suggested pattern for Edit uses file path", () => {
  const cache = new PermissionCache();
  const inv: ToolInvocation = {
    tool: "Edit",
    input: { file_path: "src/api/users.ts" },
  };
  const d = check("s1", inv, { cache, settings: emptySettings });
  expect(d.kind).toBe("ask");
  if (d.kind === "ask") {
    expect(d.suggested_pattern).toBe("Edit(src/api/users.ts)");
  }
});

test("cache isolation: session-A patterns do not unlock session-B", () => {
  const cache = new PermissionCache();
  cache.add("s-A", "Bash(npm test:*)");
  const inv: ToolInvocation = { tool: "Bash", input: { command: "npm test" } };
  const dB = check("s-B", inv, { cache, settings: emptySettings });
  expect(dB.kind).toBe("ask");
});
