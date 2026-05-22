import { test, expect } from "bun:test";
import { mergeSettingsTiers, type SettingsTier } from "../../../src/core/safety/settingsHierarchy";

test("trusted: project local and shared union into allow", () => {
  const tiers: SettingsTier[] = [
    { source: "user_global", patterns: ["Bash(ls:*)", "Edit(src/**)"], deny: [] },
    { source: "project_shared", patterns: ["Bash(npm test:*)"], deny: ["Edit(*.env)"] },
    { source: "project_local", patterns: ["Bash(rm:*)"], deny: [] },
  ];
  const merged = mergeSettingsTiers(tiers, { trustProject: true });
  expect(merged.allow).toContain("Bash(ls:*)");
  expect(merged.allow).toContain("Bash(npm test:*)");
  expect(merged.allow).toContain("Bash(rm:*)");
  expect(merged.deny).toContain("Edit(*.env)");
});

test("UNTRUSTED (default): project tiers cannot escalate allow", () => {
  // A hostile repo's settings cannot widen the user's allow set.
  const tiers: SettingsTier[] = [
    { source: "user_global", patterns: ["Bash(ls:*)"], deny: [] },
    { source: "project_shared", patterns: ["Bash(*)", "Edit(/etc/**)"], deny: [] },
    { source: "project_local", patterns: ["Bash(rm:*)"], deny: [] },
  ];
  const merged = mergeSettingsTiers(tiers);
  expect(merged.allow).toEqual(["Bash(ls:*)"]);
  expect(merged.allow).not.toContain("Bash(*)");
  expect(merged.allow).not.toContain("Bash(rm:*)");
  expect(merged.allow).not.toContain("Edit(/etc/**)");
});

test("untrusted: project tiers still contribute to deny", () => {
  // Deny always unions across all tiers (any tier may lock something down,
  // even one we don't trust to expand allows).
  const tiers: SettingsTier[] = [
    { source: "user_global", patterns: ["Bash(*)"], deny: [] },
    { source: "project_shared", patterns: [], deny: ["Bash(rm:*)", "Bash(curl:*)"] },
    { source: "project_local", patterns: [], deny: ["WebFetch(*)"] },
  ];
  const merged = mergeSettingsTiers(tiers);
  expect(merged.deny).toContain("Bash(rm:*)");
  expect(merged.deny).toContain("Bash(curl:*)");
  expect(merged.deny).toContain("WebFetch(*)");
});

test("empty tiers returns empty merged settings", () => {
  const merged = mergeSettingsTiers([]);
  expect(merged.allow).toEqual([]);
  expect(merged.deny).toEqual([]);
});
