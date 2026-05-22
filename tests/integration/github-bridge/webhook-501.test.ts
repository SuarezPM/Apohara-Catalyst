/**
 * Spec §11.2: webhook is a 501 stub for v1.0 — full implementation deferred to v1.1.
 * This test pins the contract so a future ill-advised "let's just accept it silently" change is caught.
 */
import { test, expect } from "bun:test";
import { handleWebhook, makeWebhookHandler } from "../../../packages/github-bridge/src/webhook.js";

test("webhook returns HTTP 501 Not Implemented for any payload in v1.0", async () => {
  const req = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "x-github-event": "push", "content-type": "application/json" },
    body: JSON.stringify({ ref: "refs/heads/main" }),
  });
  const result = await handleWebhook(req);
  expect(result.status).toBe(501);
  const parsed = JSON.parse(result.body);
  expect(parsed.error).toBe("not_implemented");
});

test("webhook 501 stub is not accidentally an empty 200", async () => {
  const req = new Request("http://localhost/webhook", { method: "POST" });
  const result = await handleWebhook(req);
  expect(result.status).not.toBe(200);
  expect(result.status).not.toBe(204);
});

test("makeWebhookHandler wraps handleWebhook as a Response with 501", async () => {
  const handler = makeWebhookHandler();
  const resp = await handler(new Request("http://localhost/webhook", { method: "POST" }));
  expect(resp.status).toBe(501);
  const parsed = await resp.json() as { error: string; message: string };
  expect(parsed.error).toBe("not_implemented");
  expect(parsed.message.toLowerCase()).toContain("deferred");
});

test("makeWebhookHandler 501 is not an empty 200 or 204", async () => {
  const handler = makeWebhookHandler();
  const resp = await handler(new Request("http://localhost/webhook", { method: "POST" }));
  expect(resp.status).not.toBe(200);
  expect(resp.status).not.toBe(204);
});