/**
 * Bun-based hooks loopback HTTP server.
 *
 * Mirrors the wire protocol of `crates/apohara-hooks-server` (axum
 * sidecar) so installed hook scripts work against either backend:
 *
 *   GET  /health   → { alive: true, ts }
 *   POST /event    → 200 / 400 / 401 / 413 / 422
 *
 * Bearer auth via `Authorization: Bearer <token>`. Bodies are
 * JSON-parsed with a 256 KiB cap. Endpoint info (`{port, token,
 * started_at}`) is published to `~/.apohara/agent-hooks/endpoint.json`
 * so each per-agent hook script can discover the address at runtime
 * without us touching `~/.claude/`, `~/.codex/` etc. config files.
 *
 * Every `/event` POST that authenticates and parses is forwarded as a
 * `hook_event` ledger line to the per-session JSONL the SSE handler
 * tails. The UI's bus bridge (`App.tsx`) already maps `hook_event` →
 * `apohara://hook-event` so PreToolUse / PostToolUse / Stop hits land
 * in the React store live.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { atomicWriteJson } from "../persistence/atomicWrite.js";

export interface HooksServerOptions {
	/** Port — `0` to pick a free port. */
	port?: number;
	/** Bearer token. When omitted, a random 32-byte hex is generated. */
	token?: string;
	/** Where to publish the endpoint file. Defaults to
	 * `~/.apohara/agent-hooks/endpoint.json`. */
	endpointFile?: string;
	/** Forwarder: called for every accepted hook event. Best-effort —
	 * the bun server passes a function that appends to every active
	 * session's ledger. */
	onEvent?: (event: HookEvent) => void | Promise<void>;
}

export interface HookEvent {
	/** Discriminator: `pre_tool_use` / `post_tool_use` / `stop` /
	 * `user_prompt_submit` / `permission_request`. */
	type: string;
	/** Free-form per-event payload. */
	[k: string]: unknown;
}

export interface RunningHooksServer {
	port: number;
	token: string;
	endpointFile: string | null;
	stop(): Promise<void>;
}

const BODY_LIMIT_BYTES = 256 * 1024;

function bearerEquals(provided: string, expected: string): boolean {
	const a = Buffer.from(provided, "utf-8");
	const b = Buffer.from(expected, "utf-8");
	const maxLen = Math.max(a.length, b.length);
	const padA = Buffer.alloc(maxLen);
	const padB = Buffer.alloc(maxLen);
	a.copy(padA);
	b.copy(padB);
	return timingSafeEqual(padA, padB) && a.length === b.length;
}

function defaultEndpointFile(): string {
	const home = process.env.HOME ?? homedir();
	return join(home, ".apohara", "agent-hooks", "endpoint.json");
}

export async function startHooksServer(
	opts: HooksServerOptions = {},
): Promise<RunningHooksServer> {
	const token = opts.token ?? randomBytes(32).toString("hex");
	const endpointFile = opts.endpointFile ?? defaultEndpointFile();

	const server = Bun.serve({
		port: opts.port ?? 0,
		hostname: "127.0.0.1",
		fetch: async (req) => {
			const url = new URL(req.url);

			if (req.method === "GET" && url.pathname === "/health") {
				return Response.json({ alive: true, ts: Date.now() });
			}

			if (req.method === "POST" && url.pathname === "/event") {
				const auth = req.headers.get("authorization") ?? "";
				if (
					!auth.startsWith("Bearer ") ||
					!bearerEquals(auth.slice(7), token)
				) {
					return new Response("Unauthorized", { status: 401 });
				}
				const buf = await req.arrayBuffer();
				if (buf.byteLength > BODY_LIMIT_BYTES) {
					return new Response("Payload Too Large", { status: 413 });
				}
				let body: HookEvent;
				try {
					body = JSON.parse(
						Buffer.from(buf).toString("utf-8"),
					) as HookEvent;
				} catch {
					return new Response("Invalid JSON", { status: 400 });
				}
				if (typeof body.type !== "string" || body.type.length === 0) {
					return new Response("Missing event type", { status: 422 });
				}
				try {
					await opts.onEvent?.(body);
				} catch (err) {
					console.warn(
						`hooks-server: onEvent threw: ${(err as Error).message}`,
					);
				}
				return Response.json({ accepted: true });
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	let publishedEndpointFile: string | null = null;
	try {
		await mkdir(dirname(endpointFile), { recursive: true });
		await atomicWriteJson(endpointFile, {
			port: server.port,
			token,
			started_at: Math.floor(Date.now() / 1000),
		});
		publishedEndpointFile = endpointFile;
	} catch (err) {
		console.warn(
			`hooks-server: failed to publish endpoint file: ${(err as Error).message}`,
		);
	}

	return {
		port: server.port,
		token,
		endpointFile: publishedEndpointFile,
		async stop() {
			server.stop();
		},
	};
}
