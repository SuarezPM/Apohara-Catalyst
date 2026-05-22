import { test, expect } from "bun:test";
import { createPersistentPromptStream } from "../../../../src/core/providers/streams/persistentStdin";

test("messages written before iteration are delivered in order", async () => {
  const { iter, controller } = createPersistentPromptStream<{ text: string }>();
  controller.writeMessage({ text: "first" });
  controller.writeMessage({ text: "second" });
  controller.end("completed");

  const collected: string[] = [];
  for await (const msg of iter) {
    collected.push(msg.text);
  }
  expect(collected).toEqual(["first", "second"]);
});

test("messages written during iteration are delivered", async () => {
  const { iter, controller } = createPersistentPromptStream<{ text: string }>();

  setTimeout(() => {
    controller.writeMessage({ text: "delayed" });
    controller.end("completed");
  }, 20);

  const collected: string[] = [];
  for await (const msg of iter) {
    collected.push(msg.text);
  }
  expect(collected).toEqual(["delayed"]);
});

test("write after end throws", () => {
  const { controller } = createPersistentPromptStream<{ text: string }>();
  controller.end("completed");
  expect(() => controller.writeMessage({ text: "late" })).toThrow();
});

test("end is idempotent (second end is a no-op)", () => {
  const { controller } = createPersistentPromptStream<{ text: string }>();
  controller.end("completed");
  expect(() => controller.end("interrupted")).not.toThrow();
});