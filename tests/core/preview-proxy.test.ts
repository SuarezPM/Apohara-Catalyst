/**
 * G5.F.4 — Preview-proxy (vibe-kanban #9).
 *
 * The desktop dev server is split: Bun.serve on :7331 hosts the React
 * SPA, while the daemon (the orchestrator) listens on :7332. The UI
 * needs to proxy a subset of HTTP requests to the daemon — without
 * leaking ad-hoc paths and without re-implementing the proxy logic
 * inline in every route handler.
 *
 * `createPreviewProxy({ targetOrigin, allow })` returns a single
 * `handle(req, path)` function that:
 *   - allow-lists exactly the path prefixes the proxy should forward.
 *   - rewrites the URL to the target.
 *   - copies headers (stripping hop-by-hop ones).
 *   - preserves the body for non-GET requests.
 */
import { describe, expect, test } from "bun:test";
import { createPreviewProxy } from "../../packages/desktop/src/preview-proxy";

describe("G5.F.4 — preview-proxy", () => {
	test("forwards an allowed path with method preserved", async () => {
		let seenUrl = "";
		let seenMethod = "";
		const fakeFetch = async (input: Request): Promise<Response> => {
			seenUrl = input.url;
			seenMethod = input.method;
			return new Response("ok", { status: 200 });
		};
		const proxy = createPreviewProxy({
			targetOrigin: "http://127.0.0.1:7332",
			allow: ["/api/daemon/"],
			fetch: fakeFetch,
		});
		const res = await proxy.handle(
			new Request("http://localhost:7331/api/daemon/health", { method: "GET" }),
		);
		expect(res.status).toBe(200);
		expect(seenUrl).toBe("http://127.0.0.1:7332/api/daemon/health");
		expect(seenMethod).toBe("GET");
	});

	test("rejects paths NOT on the allow-list with 404", async () => {
		const proxy = createPreviewProxy({
			targetOrigin: "http://127.0.0.1:7332",
			allow: ["/api/daemon/"],
			fetch: async () => new Response("ok"),
		});
		const res = await proxy.handle(
			new Request("http://localhost:7331/api/secret/exfiltrate"),
		);
		expect(res.status).toBe(404);
	});

	test("strips hop-by-hop headers (connection / keep-alive / transfer-encoding)", async () => {
		let seenHeaders: Record<string, string> = {};
		const fakeFetch = async (input: Request): Promise<Response> => {
			seenHeaders = Object.fromEntries(input.headers.entries());
			return new Response("ok");
		};
		const proxy = createPreviewProxy({
			targetOrigin: "http://127.0.0.1:7332",
			allow: ["/api/daemon/"],
			fetch: fakeFetch,
		});
		await proxy.handle(
			new Request("http://localhost:7331/api/daemon/ping", {
				headers: {
					"X-Allowed": "yes",
					Connection: "keep-alive",
					"Keep-Alive": "timeout=5",
					"Transfer-Encoding": "chunked",
				},
			}),
		);
		expect(seenHeaders["x-allowed"]).toBe("yes");
		expect(seenHeaders["connection"]).toBeUndefined();
		expect(seenHeaders["keep-alive"]).toBeUndefined();
		expect(seenHeaders["transfer-encoding"]).toBeUndefined();
	});

	test("forwards POST body unchanged", async () => {
		let seenBody = "";
		const fakeFetch = async (input: Request): Promise<Response> => {
			seenBody = await input.text();
			return new Response("ok");
		};
		const proxy = createPreviewProxy({
			targetOrigin: "http://127.0.0.1:7332",
			allow: ["/api/daemon/"],
			fetch: fakeFetch,
		});
		await proxy.handle(
			new Request("http://localhost:7331/api/daemon/job", {
				method: "POST",
				body: JSON.stringify({ task: "x" }),
				headers: { "Content-Type": "application/json" },
			}),
		);
		expect(seenBody).toBe('{"task":"x"}');
	});

	test("matches allow-list as prefix (`/api/daemon/` allows `/api/daemon/anything`)", async () => {
		const proxy = createPreviewProxy({
			targetOrigin: "http://127.0.0.1:7332",
			allow: ["/api/daemon/"],
			fetch: async () => new Response("ok"),
		});
		const r1 = await proxy.handle(
			new Request("http://localhost:7331/api/daemon/sub/path/deep"),
		);
		const r2 = await proxy.handle(
			new Request("http://localhost:7331/api/daemon"), // no trailing slash
		);
		expect(r1.status).toBe(200);
		expect(r2.status).toBe(404);
	});
});
