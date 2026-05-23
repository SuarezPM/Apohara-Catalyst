import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const TASKBOARD_DIR = resolve(__dirname, "..");

function findSourceWithCard() {
  for (const file of ["TaskBoardCard.tsx", "TaskBoardLane.tsx", "TaskBoard.tsx"]) {
    try {
      const content = readFileSync(resolve(TASKBOARD_DIR, file), "utf-8");
      if (content.includes("AgentStateDot")) return { file, content };
    } catch { /* file may not exist */ }
  }
  return null;
}

test("TaskBoard card (or lane) imports AgentStateDot", () => {
  const found = findSourceWithCard();
  expect(found).not.toBeNull();
  expect(found!.content).toMatch(/from\s+["']\.\.\/AgentStateDot/);
});

test("Card row renders AgentStateDot with state derived from task.status", () => {
  const found = findSourceWithCard();
  expect(found).not.toBeNull();
  expect(found!.content).toMatch(/AgentStateDot[^>]*state=/);
});

test("dotStateFor helper maps all TaskStatus values", () => {
  const found = findSourceWithCard();
  expect(found).not.toBeNull();
  const content = found!.content;
  // All 7 TaskStatus values must appear as case labels in the mapper.
  for (const status of ["dispatched", "in_verification", "blocked", "failed", "done", "ready", "pending"]) {
    expect(content).toContain(`"${status}"`);
  }
});
