import { expect, test } from "bun:test";
import {
  buildCriticPrompt,
  type CriticContext,
} from "../../../src/core/verification/prompts/critic";

test("critic prompt opens with explicit critic role", () => {
  const prompt = buildCriticPrompt({
    taskDescription: "Add JWT auth",
    priorAttempts: 0,
  });
  expect(prompt).toMatch(/you are the critic/i);
});

test("critic prompt cites prior incident when retrying same task", () => {
  const prompt = buildCriticPrompt({
    taskDescription: "Add JWT auth",
    priorAttempts: 2,
    incidents: ["leaked API key in env (2026-04-15)"],
  });
  expect(prompt).toMatch(/prior attempts: 2/i);
  expect(prompt).toContain("leaked API key in env (2026-04-15)");
  expect(prompt).toMatch(/past incidents/i);
});

test("critic prompt omits incidents section when none provided", () => {
  const prompt = buildCriticPrompt({
    taskDescription: "Refactor",
    priorAttempts: 0,
  });
  expect(prompt).not.toMatch(/past incidents/i);
});

test("critic prompt requests rationalization-detection checklist", () => {
  const prompt = buildCriticPrompt({
    taskDescription: "Refactor X",
    priorAttempts: 0,
  });
  expect(prompt).toMatch(/red flags|rationalization/i);
  // Specific checklist items
  expect(prompt).toMatch(/wrong problem/i);
  expect(prompt).toMatch(/over-engineered/i);
});

test("critic prompt requires APPROVE/NEEDS_CHANGES/REJECT verdict", () => {
  const prompt = buildCriticPrompt({
    taskDescription: "ship",
    priorAttempts: 0,
  });
  expect(prompt).toContain("APPROVE");
  expect(prompt).toContain("NEEDS_CHANGES");
  expect(prompt).toContain("REJECT");
});

test("multiple incidents enumerate as bullet list", () => {
  const ctx: CriticContext = {
    taskDescription: "redo",
    priorAttempts: 3,
    incidents: ["leak A (2026-01-01)", "race B (2026-02-02)"],
  };
  const prompt = buildCriticPrompt(ctx);
  expect(prompt).toContain("- leak A (2026-01-01)");
  expect(prompt).toContain("- race B (2026-02-02)");
});
