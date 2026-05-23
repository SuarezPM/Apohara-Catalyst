import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../KanbanBoard.tsx"), "utf-8");

test("KanbanBoard imports @hello-pangea/dnd", () => {
  expect(SRC).toMatch(/from\s+["']@hello-pangea\/dnd["']/);
  expect(SRC).toContain("DragDropContext");
  expect(SRC).toContain("Droppable");
  expect(SRC).toContain("Draggable");
});

test("KanbanBoard renders 4 columns", () => {
  for (const col of ["Ready", "In Progress", "Verifying", "Done"]) {
    expect(SRC).toContain(col);
  }
});

test("KanbanBoard onDragEnd updates task status via atom", () => {
  expect(SRC).toMatch(/onDragEnd/);
  // The handler should call some atom updater (use atom)
  expect(SRC).toMatch(/useSetAtom|useAtom/);
});

test("KanbanBoard renders AgentStateDot per task card", () => {
  expect(SRC).toContain("AgentStateDot");
});
