/**
 * Preview-proxy for the desktop dev server (vibe-kanban #9 / G5.F.4).
 *
 * The dev UI hosts the React SPA on :7331; some endpoints live on the
 * daemon (e.g. :7332). Rather than re-implementing forward logic inline
 * in every route handler, this module gives us a single
 * `createPreviewProxy({ targetOrigin, allow })` factory that returns a
 * `handle(req)` function. The handler:
 *
 *   - Restricts forwarding to an explicit prefix allow-list. Any other
 *     path returns 404 — the proxy cannot be coaxed into reaching
 *     arbitrary backend URLs.
 *   - Strips RFC 7230 hop-by-hop headers (`Connection`, `Keep-Alive`,
 *     `Transfer-Encoding`, …) that must not be forwarded.
 *   - Preserves method + body for non-GET requests so POST `/api/...`
 *     reaches the daemon intact.
 *
 * The `fetch` dependency is injectable so tests can drive the proxy
 * without spinning up a real backend.
 */

const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"transfer-encoding",
	"proxy-connection",
	"te",
	"trailer",
	"upgrade",
	"proxy-authenticate",
	"proxy-authorization",
]);

export interface PreviewProxyOptions {
	/** Where to forward — origin only, e.g. "http://127.0.0.1:7332". */
	targetOrigin: string;
	/** Path prefixes that may be forwarded. Anything else → 404. */
	allow: string[];
	/**
	 * Override the fetch used for the upstream call. Defaults to the
	 * global `fetch`; tests swap it for a stub.
	 */
	fetch?: (input: Request) => Promise<Response>;
}

export interface PreviewProxy {
	handle: (req: Request) => Promise<Response>;
}

export function createPreviewProxy(opts: PreviewProxyOptions): PreviewProxy {
	const doFetch = opts.fetch ?? ((req: Request) => fetch(req));
	const allowed = opts.allow.slice();

	return {
		handle: async (req: Request): Promise<Response> => {
			const url = new URL(req.url);
			const pathname = url.pathname;
			// Allow-list as PREFIX match — `/api/daemon/` matches
			// `/api/daemon/health`, `/api/daemon/job/123/output`, etc., but
			// NOT `/api/daemon` (no trailing path component).
			const matched = allowed.some((p) => pathname.startsWith(p));
			if (!matched) {
				return new Response("not found", { status: 404 });
			}

			// Construct the upstream URL: keep path + query, swap origin.
			const upstream = new URL(opts.targetOrigin);
			upstream.pathname = pathname;
			upstream.search = url.search;

			// Filter hop-by-hop headers before forwarding.
			const headers = new Headers();
			req.headers.forEach((value, key) => {
				if (HOP_BY_HOP.has(key.toLowerCase())) return;
				// Drop `host` — it points at the dev server, not the daemon.
				if (key.toLowerCase() === "host") return;
				headers.set(key, value);
			});

			// Body: GET / HEAD must not carry one (fetch enforces this).
			const init: RequestInit = {
				method: req.method,
				headers,
			};
			if (req.method !== "GET" && req.method !== "HEAD") {
				init.body = req.body;
			}
			// `duplex: 'half'` is required when streaming a body in undici / Bun.
			// We pass it via cast since TS lib.dom doesn't surface it yet.
			(init as unknown as Record<string, unknown>).duplex = "half";

			const forwarded = new Request(upstream.toString(), init);
			return doFetch(forwarded);
		},
	};
}
