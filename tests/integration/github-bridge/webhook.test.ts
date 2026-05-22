import { test, expect } from "bun:test";
import { handleWebhook, makeWebhookHandler } from "../../../packages/github-bridge/src/webhook.js";

test("handleWebhook always returns 501", async () => {
  const r = await handleWebhook(new Request("http://localhost/apohara-webhook", { method: "POST" }));
  expect(r.status).toBe(501);
});

test("body explains poll-only v1.0", async () => {
  const r = await handleWebhook(new Request("http://localhost/apohara-webhook"));
  const parsed = JSON.parse(r.body);
  expect(parsed.error).toBe("not_implemented");
  expect(parsed.message).toContain("poll-only");
});

test("makeWebhookHandler returns a Response with 501", async () => {
  const handler = makeWebhookHandler();
  const resp = await handler(new Request("http://localhost/apohara-webhook", { method: "POST" }));
  expect(resp.status).toBe(501);
  const json = await resp.json() as { error: string };
  expect(json.error).toBe("not_implemented");
});