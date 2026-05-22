import { test, expect } from "bun:test";
import { mergeSettingsTiers, type SettingsTier } from "../../../src/core/safety/settingsHierarchy";

test("project local overrides project shared overrides user global", () => {
  const tiers: SettingsTier[] = [
    { source: "user_global", patterns: ["Bash(ls:*)", "Edit(src/**)"], deny: [] },
    { source: "project_shared", patterns: ["Bash(npm test:*)"], deny: ["Edit(*.env)"] },
    { source: "project_local", patterns: ["Bash(rm:*)"], deny: [] },
  ];
  const merged = mergeSettingsTiers(tiers);
  expect(merged.allow).toContain("Bash(ls:*)");
  expect(merged.allow).toContain("Bash(npm test:*)");
  expect(merged.allow).toContain("Bash(rm:*)");
  expect(merged.deny).toContain("Edit(*.env)");
});

test("empty tiers returns empty merged settings", () => {
  const merged = mergeSettingsTiers([]);
  expect(merged.allow).toEqual([]);
  expect(merged.deny).toEqual([]);
});