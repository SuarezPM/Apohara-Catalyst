/**
 * webhook stub per spec §9.6.
 *
 * v1.0 ships poll-only (Task 9.4). The webhook endpoint exists so the
 * URL path is reserved for v1.1+ webhook delivery worker integration.
 * Always returns 501 Not Implemented.
 */

export interface WebhookResponse {
  status: number;
  body: string;
}

export function handleWebhook(_req: Request): Promise<WebhookResponse> {
  return Promise.resolve({
    status: 501,
    body: JSON.stringify({
      error: "not_implemented",
      message: "webhook deliveries are deferred to v1.1+; v1.0 uses poll-only ingestion (60s cadence)",
    }),
  });
}

export function makeWebhookHandler(): (req: Request) => Promise<Response> {
  return async (req) => {
    const r = await handleWebhook(req);
    return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json" } });
  };
}