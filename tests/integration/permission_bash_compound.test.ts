/**
 * Spec INV-15: compound bash never grants "always" scope, even when an
 * allow-list approves the head command. Single-command bash retains the
 * full ["once","session","always"] scope set.
 */
import { test, expect, describe } from "bun:test";
import { check } from "../../src/core/safety/permissionService";
import { PermissionCache } from "../../src/core/safety/permissionCache";
import type { MergedSettings } from "../../src/core/safety/settingsHierarchy";
import type { ToolInvocation } from "../../src/core/safety/patterns";

function settings(over: Partial<MergedSettings> = {}): MergedSettings {
  return { allow: [], deny: [], ...over };
}
function bash(command: string): ToolInvocation {
  return { tool: "Bash", input: { command } };
}

describe("INV-15: bash compound never allows 'always' scope", () => {
  test("single command with allow-list → allowed (settings_allow)", () => {
    const d = check("s1", bash("git status"), {
      cache: new PermissionCache(),
      settings: settings({ allow: ["Bash(git status:*)"] }),
    });
    expect(d.kind).toBe("allow");
  });

  test("compound 'git status && rm -rf /' with same allow-list → kind=ask, scopes=['once']", () => {
    const d = check("s1", bash("git status && rm -rf /"), {
      cache: new PermissionCache(),
      settings: settings({ allow: ["Bash(git status:*)"] }),
    });
    expect(d.kind).toBe("ask");
    if (d.kind === "ask") {
      expect(d.available_scopes).toEqual(["once"]);
      expect(d.available_scopes).not.toContain("always");
      expect(d.available_scopes).not.toContain("session");
    }
  });

  test("compound with ';' separator → scopes=['once']", () => {
    const d = check("s1", bash("git status; ls"), {
      cache: new PermissionCache(),
      settings: settings(),
    });
    expect(d.kind).toBe("ask");
    if (d.kind === "ask") expect(d.available_scopes).toEqual(["once"]);
  });

  test("compound with '||' separator → scopes=['once']", () => {
    const d = check("s1", bash("false || rm -rf /"), {
      cache: new PermissionCache(),
      settings: settings(),
    });
    expect(d.kind).toBe("ask");
    if (d.kind === "ask") expect(d.available_scopes).toEqual(["once"]);
  });

  test("explicit deny still wins over allow-list, even for single command", () => {
    const d = check("s1", bash("rm -rf /"), {
      cache: new PermissionCache(),
      settings: settings({ deny: ["Bash(rm:*)"], allow: ["Bash(rm:*)"] }),
    });
    expect(d.kind).toBe("deny");
  });

  test("regression: single 'git status' still offers full scope set", () => {
    const d = check("s1", bash("git status"), {
      cache: new PermissionCache(),
      settings: settings(),
    });
    expect(d.kind).toBe("ask");
    if (d.kind === "ask") {
      expect(d.available_scopes).toContain("always");
      expect(d.available_scopes).toContain("session");
      expect(d.available_scopes).toContain("once");
    }
  });
});
