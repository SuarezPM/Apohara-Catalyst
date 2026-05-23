import { expect, test } from "bun:test";
import { runPassthrough } from "../../src/cli/passthrough";

test("passthrough proxies exit code 0 from successful child", async () => {
  const result = await runPassthrough({
    binary: "/bin/true",
    args: [],
    interceptors: [],
  });
  expect(result.exitCode).toBe(0);
});

test("interceptors observe child output", async () => {
  const observed: string[] = [];
  const result = await runPassthrough({
    binary: "/bin/echo",
    args: ["hello"],
    interceptors: [(chunk) => { observed.push(chunk.toString()); }],
  });
  expect(observed.join("")).toContain("hello");
  expect(result.exitCode).toBe(0);
});
