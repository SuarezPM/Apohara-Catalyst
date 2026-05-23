/**
 * Bun.serve dev backend for the Apohara desktop UI (M017.1 scaffold,
 * M017.2 endpoint implementation).
 *
 * Routes:
 *   GET  /                           — serves index.html + React SPA bundle
 *   POST /api/enhance                — rewrites a user prompt via the ProviderRouter
 *   POST /api/run                    — creates a new session ledger, returns sessionId
 *   GET  /api/session/:id/events     — SSE tail of .events/run-<id>.jsonl (replay + live)
 *
 * Tauri loads localhost:7331 as devUrl in dev; the build/ output ships in release.
 */

import { existsSync, watch as fsWatch } from "node:fs";
import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { dispatchSession } from "../../../src/core/dispatch/dispatcher";
import { runReconcilerTick } from "../../../src/core/dispatch/reconciler";
import {
	watchSessionResults,
	type Disposable,
} from "../../../src/core/dispatch/result-watcher";
import { dispatchPaths } from "../../../src/core/dispatch/types";
import {
	startHooksServer,
	type RunningHooksServer,
} from "../../../src/core/hooks-server/server";
import {
	getPty,
	getReplay,
	killPty,
	listPtys,
	onPtyData,
	onPtyExit,
	resizePty,
	spawnPty,
	writePty,
} from "../../../src/core/pty/registry";
import { atomicWriteFile } from "../../../src/core/persistence/atomicWrite";
import type { ProviderId } from "../../../src/core/providers/agent-config";
import type { LLMMessage } from "../../../src/providers/router";
import { ProviderRouter } from "../../../src/providers/router";
import { replayAfter, resolveLastEventId } from "../../../src/core/sse-server";
import index from "../index.html";

const PORT = Number(process.env.APOHARA_DESKTOP_PORT ?? 7331);

/**
 * Walk upward from `process.cwd()` until we find a directory that looks
 * like the workspace root (the one carrying `Cargo.toml` + `packages/`).
 * Without this the dev server uses its own working directory (typically
 * `packages/desktop/`) as the repo root and the ledger files land under
 * `packages/desktop/.events/` instead of the workspace `.events/` —
 * scheduler-driven runs and SSE replays then look at different files.
 *
 * `APOHARA_REPO_ROOT` always wins so production deployments / tests can
 * override explicitly.
 */
function findRepoRoot(): string {
	if (process.env.APOHARA_REPO_ROOT) return process.env.APOHARA_REPO_ROOT;
	let dir = process.cwd();
	for (let i = 0; i < 8; i++) {
		if (existsSync(resolve(dir, "Cargo.toml")) && existsSync(resolve(dir, "packages"))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return process.cwd();
}
const REPO_ROOT = findRepoRoot();
const EVENTS_DIR = resolve(REPO_ROOT, ".events");
// Hard cap on accepted body bytes for the JSON endpoints. Big enough for
// reasonable prompts + roster envelopes, small enough that a hostile
// client can't OOM the dev server with a single request.
const MAX_BODY_BYTES = 256 * 1024;
// SSE max delta per watch event — caps the allocation when a writer
// appends a huge chunk between two ticks.
const MAX_DELTA_BYTES = 1 * 1024 * 1024;
// Allowed sessionId shape. Restrictive on purpose: no `..`, no slashes,
// no shell metacharacters, no NUL. Any deviation rejects the request
// before the path even reaches `join(EVENTS_DIR, ...)`.
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isSafeSessionPath(id: string): string | null {
	if (!SESSION_ID_RE.test(id)) return null;
	const candidate = resolve(EVENTS_DIR, `run-${id}.jsonl`);
	if (!candidate.startsWith(EVENTS_DIR + sep)) return null;
	return candidate;
}

async function readBoundedJson<T>(req: Request): Promise<T> {
	const buf = await req.arrayBuffer();
	if (buf.byteLength > MAX_BODY_BYTES) {
		throw new Error("body too large");
	}
	return JSON.parse(Buffer.from(buf).toString("utf-8")) as T;
}

// Single shared router for /api/enhance. The ProviderRouter holds long-lived
// state (cooldown timers, ContextForge client) so re-instantiating per request
// would defeat M015.2's connection reuse.
let sharedRouter: ProviderRouter | null = null;
function getRouter(): ProviderRouter {
	if (!sharedRouter) sharedRouter = new ProviderRouter();
	return sharedRouter;
}

// Routing-mode preference shared across endpoints. "gpu" prefers
// Carnice/ContextForge; "cloud" prefers a configured cloud provider. The mode
// can be updated via POST /api/mode and is also accepted per-request via the
// `X-Apohara-Mode` header or the `mode` body field (M017.6 / M015.5).
type RoutingMode = "gpu" | "cloud";
let routingMode: RoutingMode =
	(process.env.APOHARA_ROUTING_MODE as RoutingMode) ?? "gpu";

// Provider roster preference — the multi-AI orchestrator pitch. The UI
// (`RosterPicker`) keeps a Set<ProviderId>; the server holds the
// canonical state and accepts per-request overrides via either
// `X-Apohara-Roster: id1,id2,id3` header or `roster: [...]` in the body.
let providerRoster: Set<string> = new Set();

// Result-file watchers per session. Each `/api/run` registers one so
// the ledger gets a `task_completed` / `task_failed` event the moment
// the worker drops a result file. We hold a reference for cleanup.
const sessionWatchers = new Map<string, Disposable>();

// Session ledger paths — the reconciler iterates these every tick.
// Cleared together with the matching watcher when a session releases.
const sessionLedgers = new Map<string, string>();

// Reconciler tick interval. 30 s is the spec default (symphony §8.5).
// Cheap: one `readdir(.apohara/runs/<sid>/tasks)` per active session.
// Override via `APOHARA_RECONCILER_INTERVAL_MS=0` to disable entirely
// (tests, CI). `APOHARA_RECONCILER_STALL_MS` shadows the per-task
// stall timeout (default 5 min — see `reconciler.ts`).
const RECONCILER_INTERVAL_MS = Number(
	process.env.APOHARA_RECONCILER_INTERVAL_MS ?? "30000",
);
const RECONCILER_STALL_MS = Number(
	process.env.APOHARA_RECONCILER_STALL_MS ?? "300000",
);
if (RECONCILER_INTERVAL_MS > 0) {
	const tick = setInterval(async () => {
		for (const [sid, ledgerPath] of sessionLedgers) {
			try {
				await runReconcilerTick({
					workspace: REPO_ROOT,
					sessionId: sid,
					ledgerPath,
					stallTimeoutMs: RECONCILER_STALL_MS,
				});
			} catch {
				// Best-effort — the tick CANNOT throw because the bun
				// server then dies. Swallowing here is the right call.
			}
		}
	}, RECONCILER_INTERVAL_MS);
	tick.unref?.();
}

// T2.3 — Hooks sidecar boot. Started lazily on first /api/run so we
// don't open a port for clients that only hit /api/enhance. Each
// incoming hook event is forwarded as a `hook_event` ledger line to
// every active session — the UI bus bridge picks it up and re-emits
// onto `apohara://hook-event`.
//
// `APOHARA_HOOKS_DISABLED=1` skips boot entirely (tests / CI).
let hooksServer: RunningHooksServer | null = null;
async function ensureHooksServer(): Promise<RunningHooksServer | null> {
	if (process.env.APOHARA_HOOKS_DISABLED === "1") return null;
	if (hooksServer) return hooksServer;
	try {
		hooksServer = await startHooksServer({
			onEvent: async (event) => {
				const line = `${JSON.stringify({
					id: crypto.randomUUID(),
					timestamp: new Date().toISOString(),
					type: "hook_event",
					severity: "info",
					payload: event,
				})}\n`;
				// Best-effort fan-out to every active session ledger.
				// Hooks fire while the CLI is mid-run — the right home
				// is whichever session currently owns the worker.
				// Without a precise correlation key we broadcast and
				// let consumers filter by `payload.session_id` (which
				// claude / codex / opencode put in their hook payload).
				for (const ledgerPath of sessionLedgers.values()) {
					try {
						await appendFile(ledgerPath, line, "utf-8");
					} catch {
						/* best-effort */
					}
				}
			},
		});
		// Propagate the endpoint via env so cli-driver injects it into
		// each spawned subprocess (cli-driver's sanitizeEnv allowlist
		// preserves `APOHARA_HOOK_*` after the §0.4 strip).
		process.env.APOHARA_HOOK_ENDPOINT = `http://127.0.0.1:${hooksServer.port}`;
		process.env.APOHARA_HOOK_TOKEN = hooksServer.token;
		process.env.APOHARA_HOOK_PROTOCOL_VERSION = "1";
		console.log(
			`apohara hooks server: http://127.0.0.1:${hooksServer.port} ` +
				`(endpoint ${hooksServer.endpointFile ?? "<unpublished>"})`,
		);
	} catch (err) {
		console.warn(
			`apohara hooks server: failed to start: ${(err as Error).message}`,
		);
	}
	return hooksServer;
}

/**
 * Pick the CLI provider for `/api/run`. Honors `APOHARA_RUN_PROVIDER`
 * for overrides; otherwise picks the first member of the active roster
 * (the UI's roster picker), defaulting to claude-code-cli when nothing
 * is set. Only the 3 CLI-wrapper providers are valid here — legacy API
 * providers go through `/api/enhance`'s separate router path.
 */
function pickRunProvider(roster: Set<string>): ProviderId {
	const explicit = process.env.APOHARA_RUN_PROVIDER;
	if (
		explicit === "claude-code-cli" ||
		explicit === "codex-cli" ||
		explicit === "opencode-go"
	) {
		return explicit;
	}
	const active: ProviderId[] = ["claude-code-cli", "codex-cli", "opencode-go"];
	for (const id of active) {
		if (roster.size === 0 || roster.has(id)) return id;
	}
	return "claude-code-cli";
}

function pickEnhanceProvider(
	modeOverride: RoutingMode | undefined,
	roster: Set<string>,
): string {
	const explicit = process.env.APOHARA_ENHANCE_PROVIDER;
	if (explicit) return explicit;
	const mode = modeOverride ?? routingMode;
	const tryOrder =
		mode === "gpu"
			? ["carnice-9b-local", "claude-code-cli", "opencode-go", "openai"]
			: [
					"claude-code-cli",
					"codex-cli",
					"gemini-cli",
					"opencode-go",
					"openai",
					"anthropic-api",
				];
	for (const p of tryOrder) {
		if (roster.size === 0 || roster.has(p)) return p;
	}
	// No preferred provider made it through the roster. Pick anything
	// the user did enable so we at least try a valid provider rather
	// than failing the route entirely.
	const first = [...roster][0];
	return first ?? "opencode-go";
}

function readMode(req: Request, body: { mode?: unknown }): RoutingMode {
	const header = req.headers.get("x-apohara-mode");
	if (header === "gpu" || header === "cloud") return header;
	if (body.mode === "gpu" || body.mode === "cloud") return body.mode;
	return routingMode;
}

function readRoster(req: Request, body: { roster?: unknown }): Set<string> {
	const header = req.headers.get("x-apohara-roster");
	if (header && header.trim().length > 0) {
		return new Set(
			header
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean),
		);
	}
	if (Array.isArray(body.roster)) {
		return new Set(
			body.roster.filter((x): x is string => typeof x === "string"),
		);
	}
	return providerRoster;
}

/**
 * Read every new byte appended to `filePath` since `offset` and return
 * `{ lines, nextOffset }` where `lines` is the newline-split tail (last
 * partial chunk held back) and `nextOffset` advances by complete-line
 * bytes only. Used by the SSE handler to push only the delta on each
 * fs.watch event.
 */
async function readDelta(
	filePath: string,
	offset: number,
): Promise<{ lines: string[]; nextOffset: number }> {
	const st = await stat(filePath).catch(() => null);
	if (!st || st.size <= offset) return { lines: [], nextOffset: offset };

	// Cap the per-read delta: a writer that appends hundreds of MB
	// between two `fsWatch` events would otherwise allocate the entire
	// gap in one shot. The next watch tick (or the next poll inside the
	// stream loop) picks up the rest.
	const length = Math.min(st.size - offset, MAX_DELTA_BYTES);
	const fh = await open(filePath, "r");
	try {
		const buf = Buffer.alloc(length);
		await fh.read(buf, 0, length, offset);
		const chunk = buf.toString("utf-8");
		// Hold back any trailing partial line so we don't emit half a JSON object.
		const lastNL = chunk.lastIndexOf("\n");
		if (lastNL === -1) return { lines: [], nextOffset: offset };
		const complete = chunk.slice(0, lastNL);
		const advance = Buffer.byteLength(complete, "utf-8") + 1; // +1 for '\n'
		const lines = complete.split("\n").filter((l) => l.trim().length > 0);
		return { lines, nextOffset: offset + advance };
	} finally {
		await fh.close();
	}
}

const server = Bun.serve({
	port: PORT,
	development: {
		hmr: true,
		console: true,
	},
	routes: {
		"/": index,

		// POST /api/enhance — rewrite a prompt for clarity using the
		// existing ProviderRouter (M017.2). Response shape stays
		// `{ enhanced: string, ... }` so React Objective pane consumes
		// the same JSON as the M017.1 stub.
		"/api/enhance": {
			POST: async (req) => {
				let prompt = "";
				let bodyMode: RoutingMode | undefined;
				let roster: Set<string> = providerRoster;
				try {
					const body = await readBoundedJson<{
						prompt?: string;
						mode?: unknown;
						roster?: unknown;
					}>(req);
					prompt = (body.prompt ?? "").trim();
					bodyMode = readMode(req, body);
					roster = readRoster(req, body);
				} catch (err) {
					const msg = (err as Error).message;
					if (msg === "body too large") {
						return Response.json({ error: msg }, { status: 413 });
					}
					return Response.json({ error: "invalid JSON body" }, { status: 400 });
				}
				if (!prompt) {
					return Response.json({ error: "prompt is required" }, { status: 400 });
				}

				const messages: LLMMessage[] = [
					{
						role: "system",
						content:
							"You are a prompt-rewriting assistant for an autonomous coding agent. " +
							"Rewrite the user's request to be unambiguous, specific, and testable. " +
							"Keep it under 200 words. Output ONLY the rewritten prompt, no preamble.",
					},
					{ role: "user", content: prompt },
				];

				const provider = pickEnhanceProvider(bodyMode, roster);

				try {
					const result = await getRouter().completion({
						messages,
						agentId: "desktop-enhance",
						// biome-ignore lint/suspicious/noExplicitAny: ProviderId type is internal
						provider: provider as any,
					});
					return Response.json({
						enhanced: result.content,
						provider: result.provider,
						model: result.model,
						usage: result.usage,
						mode: bodyMode ?? routingMode,
						roster: [...roster],
					});
				} catch (err) {
					return Response.json(
						{
							enhanced: prompt,
							error: (err as Error).message,
							fallback: true,
						},
						{ status: 502 },
					);
				}
			},
		},

		// POST /api/mode — update the server's preferred routing mode (M015.5).
		// The server holds the canonical setting; clients sync via localStorage
		// for instant UI feedback. Body: `{ mode: "gpu" | "cloud" }`.
		"/api/mode": {
			POST: async (req) => {
				let body: { mode?: unknown } = {};
				try {
					body = await readBoundedJson<{ mode?: unknown }>(req);
				} catch (err) {
					const msg = (err as Error).message;
					if (msg === "body too large") {
						return Response.json({ error: msg }, { status: 413 });
					}
					return Response.json({ error: "invalid JSON body" }, { status: 400 });
				}
				if (body.mode !== "gpu" && body.mode !== "cloud") {
					return Response.json(
						{ error: "mode must be 'gpu' or 'cloud'" },
						{ status: 400 },
					);
				}
				routingMode = body.mode;
				return Response.json({ mode: routingMode });
			},
			GET: () => Response.json({ mode: routingMode }),
		},

		// POST /api/roster — update the canonical multi-AI roster (the
		// "pick which AIs participate in this run" set). Body shape:
		// `{ providers: ["claude-code-cli", "openai", ...] }`. GET
		// returns the current roster.
		"/api/roster": {
			POST: async (req) => {
				let body: { providers?: unknown } = {};
				try {
					body = await readBoundedJson<{ providers?: unknown }>(req);
				} catch (err) {
					const msg = (err as Error).message;
					if (msg === "body too large") {
						return Response.json({ error: msg }, { status: 413 });
					}
					return Response.json({ error: "invalid JSON body" }, { status: 400 });
				}
				if (!Array.isArray(body.providers)) {
					return Response.json(
						{ error: "providers must be an array of strings" },
						{ status: 400 },
					);
				}
				providerRoster = new Set(
					body.providers.filter((x): x is string => typeof x === "string"),
				);
				return Response.json({ providers: [...providerRoster] });
			},
			GET: () => Response.json({ providers: [...providerRoster] }),
		},

		// GET /api/health — lightweight liveness probe for the tmux bridge,
		// reverse proxies, and the visual-verdict QA loop.
		"/api/health": () =>
			Response.json({
				ok: true,
				port: PORT,
				mode: routingMode,
				eventsDir: EVENTS_DIR,
			}),

		// --- T2.1 PTY routes — embedded terminal sessions. ---

		// POST /api/pty — spawn a PTY. Body:
		// `{command, args?, cwd?, cols?, rows?, sessionId?, taskId?}`.
		// Returns `{ptyId, pid, startedAt}`.
		"/api/pty": {
			POST: async (req) => {
				let body: {
					command?: string;
					args?: string[];
					cwd?: string;
					cols?: number;
					rows?: number;
					sessionId?: string;
					taskId?: string;
				} = {};
				try {
					body = await readBoundedJson(req);
				} catch (err) {
					const msg = (err as Error).message;
					if (msg === "body too large") {
						return Response.json({ error: msg }, { status: 413 });
					}
					return Response.json({ error: "invalid JSON body" }, { status: 400 });
				}
				if (typeof body.command !== "string" || body.command.length === 0) {
					return Response.json(
						{ error: "command is required" },
						{ status: 400 },
					);
				}
				try {
					const handle = spawnPty({
						command: body.command,
						args: body.args,
						cwd: body.cwd ?? REPO_ROOT,
						cols: body.cols,
						rows: body.rows,
						sessionId: body.sessionId,
						taskId: body.taskId,
					});
					return Response.json(handle);
				} catch (err) {
					return Response.json(
						{ error: (err as Error).message },
						{ status: 500 },
					);
				}
			},
			GET: () => Response.json({ ptys: listPtys() }),
		},

		// GET /api/pty/:id/stream — SSE stream of PTY output.
		// First message replays the 100 KiB scrollback so re-attaching
		// rebuilds the terminal cleanly; subsequent messages are live.
		"/api/pty/:id/stream": (req) => {
			const id = req.params.id;
			if (!getPty(id)) return new Response("not found", { status: 404 });
			const stream = new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					let closed = false;
					const send = (data: string) => {
						if (closed) return;
						try {
							controller.enqueue(encoder.encode(data));
						} catch {
							closed = true;
						}
					};

					// 1) Replay scrollback as one base64 chunk so the client
					// can drop it into xterm.js wholesale without per-line
					// reparse. (Base64 keeps control chars + non-utf8 safe
					// across SSE's line-oriented framing.)
					const replay = getReplay(id);
					if (replay) {
						send(
							`event: replay\ndata: ${Buffer.from(replay, "utf-8").toString("base64")}\n\n`,
						);
					}

					// 2) Live data — same base64 transport.
					const offData = onPtyData(id, (chunk) => {
						send(
							`data: ${Buffer.from(chunk, "utf-8").toString("base64")}\n\n`,
						);
					});
					const offExit = onPtyExit(id, (code) => {
						send(`event: exit\ndata: ${code}\n\n`);
						closed = true;
						try {
							controller.close();
						} catch {
							/* already closed */
						}
					});

					// 3) Heartbeat so proxies don't drop the connection.
					const heartbeat = setInterval(() => {
						send(`: heartbeat ${Date.now()}\n\n`);
					}, 15_000);

					req.signal.addEventListener("abort", () => {
						closed = true;
						clearInterval(heartbeat);
						offData();
						offExit();
						try {
							controller.close();
						} catch {
							/* already closed */
						}
					});
				},
			});
			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			});
		},

		// POST /api/pty/:id/input — feed bytes to the PTY's stdin.
		// Body: text payload (plain string, no JSON wrapper) so the
		// keyboard handler in xterm.js can call this directly without
		// serializing. Bounded to 64 KiB.
		"/api/pty/:id/input": {
			POST: async (req) => {
				const id = req.params.id;
				if (!getPty(id)) return new Response("not found", { status: 404 });
				const buf = await req.arrayBuffer();
				if (buf.byteLength > 64 * 1024) {
					return Response.json({ error: "body too large" }, { status: 413 });
				}
				const text = Buffer.from(buf).toString("utf-8");
				if (!writePty(id, text)) {
					return Response.json({ error: "pty closed" }, { status: 410 });
				}
				return Response.json({ accepted: true });
			},
		},

		// POST /api/pty/:id/resize — update cols + rows.
		"/api/pty/:id/resize": {
			POST: async (req) => {
				const id = req.params.id;
				if (!getPty(id)) return new Response("not found", { status: 404 });
				let body: { cols?: number; rows?: number } = {};
				try {
					body = await readBoundedJson(req);
				} catch {
					return Response.json({ error: "invalid JSON body" }, { status: 400 });
				}
				if (
					typeof body.cols !== "number" ||
					typeof body.rows !== "number" ||
					body.cols < 1 ||
					body.rows < 1
				) {
					return Response.json(
						{ error: "cols + rows are required integers >= 1" },
						{ status: 400 },
					);
				}
				resizePty(id, body.cols, body.rows);
				return Response.json({ cols: body.cols, rows: body.rows });
			},
		},

		// DELETE /api/pty/:id — kill the PTY.
		"/api/pty/:id": {
			DELETE: (req) => {
				const id = req.params.id;
				if (!getPty(id)) return new Response("not found", { status: 404 });
				killPty(id);
				return Response.json({ killed: true });
			},
			GET: (req) => {
				const id = req.params.id;
				const handle = getPty(id);
				if (!handle) return new Response("not found", { status: 404 });
				return Response.json(handle);
			},
		},

		// POST /api/run — minimal session-start hook (M017.2). The full
		// scheduler spawn lands in M017.3+ when the UI can drive it. For
		// now we create the session's ledger file + write a
		// `session_started` event so the SSE endpoint can tail something
		// the instant the client subscribes.
		"/api/run": {
			POST: async (req) => {
				let prompt = "";
				let mode: RoutingMode = routingMode;
				let roster: Set<string> = providerRoster;
				try {
					const body = await readBoundedJson<{
						prompt?: string;
						mode?: unknown;
						roster?: unknown;
					}>(req);
					prompt = (body.prompt ?? "").trim();
					mode = readMode(req, body);
					roster = readRoster(req, body);
				} catch (err) {
					const msg = (err as Error).message;
					if (msg === "body too large") {
						return Response.json({ error: msg }, { status: 413 });
					}
					return Response.json({ error: "invalid JSON body" }, { status: 400 });
				}

				// `crypto.randomUUID()` (~122 bits) replaces the old
				// `Math.random()` + `Date.now()` slug. `Math.random` is
				// not cryptographically secure and the slug was only ~30
				// bits, predictable enough that a client guessing ids
				// could tail another session via the SSE endpoint
				// (combined with the path-traversal fix on
				// `/api/session/:id/events`, this closes that surface).
				const sessionId = `desktop-${crypto.randomUUID().replace(/-/g, "")}`;
				await mkdir(EVENTS_DIR, { recursive: true });
				const ledgerPath = join(EVENTS_DIR, `run-${sessionId}.jsonl`);
				const provider = pickRunProvider(roster);
				const event = {
					id: crypto.randomUUID(),
					timestamp: new Date().toISOString(),
					type: "session_started",
					severity: "info",
					payload: {
						prompt,
						source: "desktop",
						mode,
						roster: [...roster],
						provider,
					},
				};
				// §0.8 atomic write — even though this is the first write
				// of a new file, an SSE consumer connecting while the
				// initial write is in flight previously saw an empty
				// replay because `existsSync` could pass before flush.
				await atomicWriteFile(ledgerPath, `${JSON.stringify(event)}\n`);

				// T1.1 — actually dispatch the prompt to the picked CLI
				// provider. The dispatcher writes an instruction file,
				// returns immediately, and the worker (spawned in-process
				// for v1) writes a result file when it finishes. The
				// session watcher below converts the result write into
				// a `task_completed` / `task_failed` ledger event the SSE
				// stream picks up live.
				//
				// `APOHARA_DISPATCH_DISABLED=1` skips the worker spawn
				// (useful for tests / CI / when the user only wants the
				// session_started signal).
				// Start the hooks sidecar lazily before the first
				// dispatch so spawned CLIs can find the endpoint file.
				await ensureHooksServer();

				if (process.env.APOHARA_DISPATCH_DISABLED !== "1" && prompt) {
					// Replace any prior watcher for the same session id
					// (defensive — sessionIds are UUIDs so collisions are
					// effectively impossible, but a leak here would leak a
					// `fs.watch` handle per re-run).
					const prior = sessionWatchers.get(sessionId);
					if (prior) prior.close();
					// Pre-create the results directory so `fs.watch` can attach
					// BEFORE the dispatcher's first worker writes its result.
					// Without this the watcher attempted to watch a missing
					// directory and missed the result file entirely (the
					// retry-after-500ms path was firing after the result had
					// already landed in fast cases).
					const paths = dispatchPaths(REPO_ROOT, sessionId);
					await mkdir(paths.results, { recursive: true });
					const watcher = watchSessionResults({
						workspace: REPO_ROOT,
						sessionId,
						ledgerPath,
					});
					sessionWatchers.set(sessionId, watcher);
					sessionLedgers.set(sessionId, ledgerPath);
					try {
						await dispatchSession({
							workspace: REPO_ROOT,
							sessionId,
							prompt,
							providerId: provider,
							ledgerPath,
						});
					} catch (err) {
						// Best-effort APPEND the dispatch-setup failure to
						// the ledger (the dispatcher may have already added
						// a `task_scheduled` line). The watcher will still
						// see any result the worker did manage to write.
						const failureEvent = {
							id: crypto.randomUUID(),
							timestamp: new Date().toISOString(),
							type: "task_failed",
							severity: "error",
							payload: {
								provider,
								error: `dispatch setup failed: ${(err as Error).message}`,
							},
							metadata: { provider },
						};
						await appendFile(
							ledgerPath,
							`${JSON.stringify(failureEvent)}\n`,
							"utf-8",
						).catch(() => {
							/* ledger may have moved on already — ignore */
						});
					}
				}
				return Response.json({
					sessionId,
					ledger: ledgerPath,
					mode,
					roster: [...roster],
					provider,
				});
			},
		},

		// GET /api/session/:id/events — SSE replay + live tail.
		// Replays the full ledger file once on connect, then streams
		// every appended line as fs.watch reports changes. Heartbeat
		// every 15 s so proxies don't drop the connection.
		//
		// G7.C.4 — Honors `Last-Event-ID` header (or `?lastEventId=`
		// fallback) so reconnecting clients only see events strictly
		// after their last anchor. The server emits SSE `id:` lines so
		// browser-native EventSource tracks the cursor automatically.
		// `resolveLastEventId` rejects newline injection; `replayAfter`
		// falls back to the full tail when the anchor is unknown (the
		// client de-dupes by id).
		"/api/session/:id/events": (req) => {
			const id = req.params.id;
			const filePath = isSafeSessionPath(id);
			if (!filePath) {
				// Reject path-traversal / malformed ids up-front. The
				// validation regex + `startsWith(EVENTS_DIR + sep)` check
				// closes the `req.params.id === ".."` style escape that
				// would otherwise let a client tail arbitrary
				// `run-*.jsonl` files (or escape `.events/` entirely).
				return new Response("invalid session id", { status: 400 });
			}
			if (!existsSync(filePath)) {
				return new Response("ledger not found", { status: 404 });
			}

			const anchor = resolveLastEventId(req);

			const stream = new ReadableStream({
				async start(controller) {
					const encoder = new TextEncoder();
					let offset = 0;
					let closed = false;
					// Single-flight readDelta chain. `fsWatch` fires
					// synchronously on every append and the old code
					// kicked off a new `readDelta` per tick — two
					// overlapping reads both observed the same `offset`,
					// both read the same byte range, and both advanced
					// `offset = delta.nextOffset` — duplicating lines on
					// rapid bursts. Serializing through `pending` makes
					// every read see the prior read's advanced offset.
					let pending: Promise<void> = Promise.resolve();
					const send = (data: string) => {
						if (closed) return;
						try {
							controller.enqueue(encoder.encode(data));
						} catch {
							teardown();
						}
					};
					/**
					 * Emit one ledger line as an SSE frame with the line's
					 * event id so browsers can track Last-Event-ID natively
					 * across drops. The id has been newline-stripped by the
					 * JSON parse, but be defensive — an event whose id
					 * contains `\n` would corrupt the SSE frame structure.
					 */
					const emit = (line: string) => {
						let evId: string | undefined;
						try {
							const parsed = JSON.parse(line) as { id?: unknown };
							if (typeof parsed?.id === "string" && !/[\n\r]/.test(parsed.id)) {
								evId = parsed.id;
							}
						} catch {
							/* Malformed line: emit without id — never throws. */
						}
						if (evId) {
							send(`id: ${evId}\ndata: ${line}\n\n`);
						} else {
							send(`data: ${line}\n\n`);
						}
					};

					// 1) Initial replay — narrowed to "events after anchor"
					// when the client sent Last-Event-ID. The watcher below
					// picks up from `offset = file size at replay time`.
					try {
						const lines = await replayAfter(filePath, anchor);
						for (const line of lines) emit(line);
						// Prime offset to the current file end so the watcher
						// only emits NEW appends after this point.
						const st = await stat(filePath).catch(() => null);
						if (st) offset = st.size;
					} catch {
						/* best-effort; watcher will catch up */
					}
					const drainOnce = async () => {
						const delta = await readDelta(filePath, offset).catch(() => ({
							lines: [],
							nextOffset: offset,
						}));
						for (const line of delta.lines) {
							emit(line);
						}
						offset = delta.nextOffset;
					};

					// 2) Watch the file for new appends.
					const watcher = fsWatch(filePath, () => {
						pending = pending.then(drainOnce, drainOnce);
					});

					// 3) Heartbeat — SSE comment, ignored by clients, keeps the
					//    TCP/HTTP path alive through any intermediate proxy.
					const heartbeat = setInterval(() => {
						send(`: heartbeat ${Date.now()}\n\n`);
					}, 15_000);

					const teardown = () => {
						if (closed) return;
						closed = true;
						clearInterval(heartbeat);
						try {
							watcher.close();
						} catch {
							/* ignore */
						}
						try {
							controller.close();
						} catch {
							/* already closed */
						}
					};

					// 4) Clean up on client disconnect OR on any send error.
					req.signal.addEventListener("abort", teardown);
				},
			});

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			});
		},
	},
});

console.log(`Apohara desktop dev server: http://localhost:${server.port}`);
console.log(`Events dir: ${EVENTS_DIR}`);
