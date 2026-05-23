/**
 * G5.A.11 — pure profiles (vibe-kanban inspiration).
 *
 * A "pure" profile constrains a session to read-only/sandboxed
 * operations: no file writes, no shell commands, no network egress,
 * no git operations. Used for evaluation runs, dry-runs, and the
 * "what would the agent say?" preview path.
 *
 * `applyPureProfile(profile, spec)` produces a SafetyDecision the
 * permission service consumes; `isAllowed(profile, action)` is a
 * quick helper for UI gating.
 */
import { test, expect } from "bun:test";
import {
  PURE_PROFILES,
  applyPureProfile,
  isAllowed,
  getPureProfile,
  type PureAction,
} from "../../../src/core/safety/pure-profiles";

test("PURE_PROFILES exports the canonical profile list", () => {
  expect(PURE_PROFILES).toContain("strict");
  expect(PURE_PROFILES).toContain("read_only");
  expect(PURE_PROFILES).toContain("eval");
});

test("strict profile disallows all side-effecting actions", () => {
  const p = getPureProfile("strict");
  const actions: PureAction[] = [
    "file_write",
    "shell_exec",
    "git_commit",
    "network_egress",
  ];
  for (const a of actions) {
    expect(p.allowed[a]).toBe(false);
  }
  expect(p.allowed.file_read).toBe(true);
});

test("read_only allows network but no writes", () => {
  const p = getPureProfile("read_only");
  expect(p.allowed.file_read).toBe(true);
  expect(p.allowed.network_egress).toBe(true);
  expect(p.allowed.file_write).toBe(false);
  expect(p.allowed.git_commit).toBe(false);
});

test("isAllowed returns the profile's decision for an action", () => {
  expect(isAllowed("strict", "file_write")).toBe(false);
  expect(isAllowed("strict", "file_read")).toBe(true);
  expect(isAllowed("read_only", "network_egress")).toBe(true);
});

test("applyPureProfile returns a SafetyDecision matching the profile", () => {
  const decision = applyPureProfile("strict", "file_write");
  expect(decision.allowed).toBe(false);
  expect(decision.reason).toContain("strict");
  const ok = applyPureProfile("read_only", "file_read");
  expect(ok.allowed).toBe(true);
});

test("getPureProfile on unknown name throws", () => {
  expect(() => getPureProfile("nonexistent" as never)).toThrow();
});

test("eval profile allows file_write under a tmp dir but no commits", () => {
  const p = getPureProfile("eval");
  expect(p.allowed.file_read).toBe(true);
  expect(p.allowed.file_write).toBe(true);
  expect(p.allowed.git_commit).toBe(false);
  expect(p.allowed.network_egress).toBe(false);
});
