import { expect, test } from "bun:test";
import { dispatchUniversalVerb } from "../../src/cli/universal-verbs";

test("explain returns the description of an entity", async () => {
  const result = await dispatchUniversalVerb({
    verb: "explain",
    target: "task:abc-123",
    registry: {
      "task:abc-123": { description: "Add JWT auth", state: "ready" },
    },
  });
  expect(result).toContain("Add JWT auth");
  expect(result).toContain("ready");
});

test("overview returns aggregate summary", async () => {
  const result = await dispatchUniversalVerb({
    verb: "overview",
    target: "session:foo",
    registry: {
      "session:foo": { taskCount: 5, doneCount: 3 },
    },
  });
  expect(result).toMatch(/5.*tasks/i);
});

test("rejects unknown verb", async () => {
  await expect(
    // biome-ignore lint/suspicious/noExplicitAny: invalid verb is the point of the test
    dispatchUniversalVerb({ verb: "foo" as any, target: "x", registry: {} })
  ).rejects.toThrow(/unknown verb/);
});
