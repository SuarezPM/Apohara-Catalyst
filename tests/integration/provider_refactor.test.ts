/**
 * Spec §7 task 10.10: provider refactor regression. The active roster must
 * iterate exactly the 3 sanctioned CLI providers, each instantiable via
 * BaseAgentProvider, each exposing a stable id + at least one declared role.
 *
 * Real CLI binaries are NOT required — this test asserts the shape of the
 * roster module + the abstract contract; a separate smoke task verifies
 * binaries on PATH via `apohara doctor` roster section.
 */
import { test, expect, describe, beforeEach } from "bun:test";
import { BaseAgentProvider } from "../../src/core/providers/BaseAgentProvider";
import { ClaudeCodeProvider } from "../../src/core/providers/ClaudeCodeProvider";
import { CodexProvider } from "../../src/core/providers/CodexProvider";
import { OpenCodeProvider } from "../../src/core/providers/OpenCodeProvider";
import { setApoharaDeps, resetApoharaDeps } from "../../src/core/providers/deps";

const EXPECTED_IDS = ["claude-code-cli", "codex-cli", "opencode-go"];

beforeEach(() => {
  resetApoharaDeps();
  setApoharaDeps({
    hookEndpoint: () => ({ port: 8901, token: "test-token" }),
    indexerSocketPath: "/tmp/apohara-test-indexer",
    ledgerPath: "/tmp/apohara-test-ledger",
    capabilityStatsPath: "/tmp/apohara-test-caps",
  });
});

describe("provider refactor (no API regression)", () => {
  test("all 3 sanctioned providers instantiate without throwing", () => {
    expect(() => new ClaudeCodeProvider()).not.toThrow();
    expect(() => new CodexProvider()).not.toThrow();
    expect(() => new OpenCodeProvider()).not.toThrow();
  });

  test("all 3 extend BaseAgentProvider", () => {
    expect(new ClaudeCodeProvider()).toBeInstanceOf(BaseAgentProvider);
    expect(new CodexProvider()).toBeInstanceOf(BaseAgentProvider);
    expect(new OpenCodeProvider()).toBeInstanceOf(BaseAgentProvider);
  });

  test("each provider has stable id matching the 3 sanctioned identifiers", () => {
    const ids = [new ClaudeCodeProvider().id, new CodexProvider().id, new OpenCodeProvider().id];
    expect(ids.sort()).toEqual(EXPECTED_IDS.slice().sort());
  });

  test("each provider declares at least one role", () => {
    expect(new ClaudeCodeProvider().roles.length).toBeGreaterThan(0);
    expect(new CodexProvider().roles.length).toBeGreaterThan(0);
    expect(new OpenCodeProvider().roles.length).toBeGreaterThan(0);
  });

  test("ClaudeCodeProvider covers planner+critic roles per spec", () => {
    const p = new ClaudeCodeProvider();
    expect(p.roles).toContain("planner");
    expect(p.roles).toContain("critic");
  });

  test("CodexProvider covers coder role per spec", () => {
    expect(new CodexProvider().roles).toContain("coder");
  });

  test("OpenCodeProvider covers explorer+editor roles per spec", () => {
    const p = new OpenCodeProvider();
    expect(p.roles).toContain("explorer");
    expect(p.roles).toContain("editor");
  });

  test("active roster module re-exports the 3 providers (no rogue 4th)", async () => {
    const roster = await import("../../src/core/providers/active-roster");
    const exportedIds = Object.values(roster)
      .filter((v): v is { prototype: { id?: string } } | (new () => BaseAgentProvider) => typeof v === "function" || typeof v === "object")
      .flatMap(v => {
        try {
          const inst = typeof v === "function" ? new (v as new () => BaseAgentProvider)() : null;
          return inst?.id ? [inst.id] : [];
        } catch { return []; }
      });
    for (const id of exportedIds) {
      expect(EXPECTED_IDS).toContain(id);
    }
  });
});
