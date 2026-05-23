/**
 * G5.A.9 — EditorHost contract + useEditorLifecycle hook (T3.7).
 *
 * The EditorHost is a small contract that any editor implementation
 * (Monaco, Markdown, CSV) must satisfy so the lifecycle hook can drive
 * mount → dirty-track → save → unmount uniformly. Tests here exercise
 * the contract via a mock implementation; the React wrapper consumes
 * the same contract.
 */
import { test, expect } from "bun:test";
import {
  EditorRegistry,
  resolveEditorForPath,
  createEditorLifecycle,
  type EditorHost,
} from "../../src/editors/index.js";

class MockEditor implements EditorHost {
  static id = "mock";
  mounted = false;
  saved: string[] = [];
  content = "";
  async mount(initial: string) {
    this.mounted = true;
    this.content = initial;
  }
  async unmount() {
    this.mounted = false;
  }
  isDirty() {
    return this.saved.at(-1) !== this.content;
  }
  async save() {
    this.saved.push(this.content);
  }
  setContent(s: string) {
    this.content = s;
  }
}

test("EditorRegistry registers and resolves editors by file extension", () => {
  const reg = new EditorRegistry();
  reg.register(["ts", "tsx", "js"], () => new MockEditor());
  reg.register(["md"], () => new MockEditor());
  expect(reg.canHandle("/x/foo.tsx")).toBe(true);
  expect(reg.canHandle("/x/foo.md")).toBe(true);
  expect(reg.canHandle("/x/foo.unknown")).toBe(false);
});

test("resolveEditorForPath returns null if no editor handles the extension", () => {
  const reg = new EditorRegistry();
  reg.register(["ts"], () => new MockEditor());
  expect(resolveEditorForPath(reg, "/x/foo.unknown")).toBeNull();
});

test("EditorLifecycle.mount transitions to mounted state", async () => {
  const editor = new MockEditor();
  const lc = createEditorLifecycle(editor);
  expect(lc.state()).toBe("idle");
  await lc.mount("hello world");
  expect(lc.state()).toBe("mounted");
  expect(editor.mounted).toBe(true);
  expect(editor.content).toBe("hello world");
});

test("EditorLifecycle.save delegates to host then marks clean", async () => {
  const editor = new MockEditor();
  const lc = createEditorLifecycle(editor);
  await lc.mount("v1");
  editor.setContent("v2");
  expect(lc.isDirty()).toBe(true);
  await lc.save();
  expect(editor.saved.length).toBe(1);
  expect(editor.saved[0]).toBe("v2");
  expect(lc.isDirty()).toBe(false);
});

test("EditorLifecycle.unmount transitions to closed", async () => {
  const editor = new MockEditor();
  const lc = createEditorLifecycle(editor);
  await lc.mount("x");
  await lc.unmount();
  expect(lc.state()).toBe("closed");
  expect(editor.mounted).toBe(false);
});

test("EditorLifecycle.unmount on un-mounted host is a no-op (does not throw)", async () => {
  const editor = new MockEditor();
  const lc = createEditorLifecycle(editor);
  await lc.unmount();
  expect(lc.state()).toBe("closed");
});
