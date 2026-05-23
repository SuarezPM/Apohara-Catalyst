/**
 * G5.A.10 — capabilities-based feature flags (vibe-kanban inspiration).
 *
 * A feature is `enabled` if (a) it is not in the user opt-out list AND
 * (b) every prerequisite capability is supported by the *active* provider.
 * UI components query `featureFlags.isEnabled(featureName, providerId)`.
 */
import { test, expect } from "bun:test";
import {
  registerFeature,
  isFeatureEnabled,
  resetFeatureFlags,
  setFeatureOptOut,
  listFeatures,
} from "../../src/core/feature-flags";

test("registerFeature and isFeatureEnabled with all caps present", () => {
  resetFeatureFlags();
  registerFeature("multi_turn_ui", {
    requires: ["multi_turn", "streaming"],
  });
  expect(isFeatureEnabled("multi_turn_ui", "claude-code-cli")).toBe(true);
});

test("isFeatureEnabled false when a required capability is missing", () => {
  resetFeatureFlags();
  registerFeature("subagent_panel", {
    requires: ["subagent_spawn"],
  });
  // No active provider supports subagent_spawn → false.
  expect(isFeatureEnabled("subagent_panel", "claude-code-cli")).toBe(false);
});

test("setFeatureOptOut disables a feature even if caps are present", () => {
  resetFeatureFlags();
  registerFeature("multi_turn_ui", { requires: ["multi_turn"] });
  setFeatureOptOut("multi_turn_ui", true);
  expect(isFeatureEnabled("multi_turn_ui", "claude-code-cli")).toBe(false);
  setFeatureOptOut("multi_turn_ui", false);
  expect(isFeatureEnabled("multi_turn_ui", "claude-code-cli")).toBe(true);
});

test("listFeatures returns all registered feature names", () => {
  resetFeatureFlags();
  registerFeature("alpha", { requires: [] });
  registerFeature("beta", { requires: [] });
  const names = listFeatures();
  expect(names).toContain("alpha");
  expect(names).toContain("beta");
});

test("isFeatureEnabled on unknown feature returns false", () => {
  resetFeatureFlags();
  expect(isFeatureEnabled("never-registered", "claude-code-cli")).toBe(false);
});

test("feature with empty requires is always enabled unless opted-out", () => {
  resetFeatureFlags();
  registerFeature("free", { requires: [] });
  expect(isFeatureEnabled("free", "claude-code-cli")).toBe(true);
  expect(isFeatureEnabled("free", "codex-cli")).toBe(true);
});
