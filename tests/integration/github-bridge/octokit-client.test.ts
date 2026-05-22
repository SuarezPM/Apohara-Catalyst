import { test, expect } from "bun:test";
import { OctokitClient } from "../../../packages/github-bridge/src/octokit-client.js";

test("OctokitClient constructs with default UA", () => {
  const c = new OctokitClient();
  expect(c.octokit).toBeDefined();
});

test("request returns result on success first try", async () => {
  const c = new OctokitClient();
  const r = await c.request(async () => ({ foo: "bar" }));
  expect(r.foo).toBe("bar");
});

test("request retries on 500 then succeeds", async () => {
  const c = new OctokitClient({ maxRetries: 2 });
  let attempts = 0;
  const r = await c.request(async () => {
    attempts += 1;
    if (attempts < 2) {
      const e = new Error("server error") as Error & { status: number };
      e.status = 500;
      throw e;
    }
    return { ok: true };
  });
  expect(r.ok).toBe(true);
  expect(attempts).toBe(2);
});

test("request gives up after maxRetries on persistent 5xx", async () => {
  const c = new OctokitClient({ maxRetries: 2 });
  await expect(c.request(async () => {
    const e = new Error("always fails") as Error & { status: number };
    e.status = 503;
    throw e;
  })).rejects.toThrow(/always fails/);
});

test("request propagates 4xx without retry", async () => {
  const c = new OctokitClient({ maxRetries: 5 });
  let attempts = 0;
  await expect(c.request(async () => {
    attempts += 1;
    const e = new Error("not found") as Error & { status: number };
    e.status = 404;
    throw e;
  })).rejects.toThrow(/not found/);
  expect(attempts).toBe(1);
});
