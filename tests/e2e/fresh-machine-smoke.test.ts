/**
 * G7.E.1 — Fresh-machine happy-path smoke.
 *
 * Models the journey a brand-new user takes the first time they install
 * apohara: `npx apohara` boots the desktop server, the UI seeds a demo
 * task, the user clicks "Run", and the kanban transitions the task to
 * Done as the dispatcher fans events back through SSE.
 *
 * What this test exercises end-to-end:
 *
 *   1. Spawn `packages/desktop/src/server.ts` as a child process on a
 *      randomly-picked port, scoped to a scratch `APOHARA_REPO_ROOT` so
 *      no events leak into the developer's workspace.
 *   2. Poll `/api/health` until the server announces itself — this is
 *      the same liveness check the tmux bridge uses (server.ts:467).
 *   3. POST `/api/run` with a prompt and an explicit `roster` so the
 *      server returns a deterministic `provider` + `sessionId` + `ledger`.
 *   4. Open the SSE stream at `/api/session/:id/events` and verify the
 *      replay surface emits a `session_started` event whose payload
 *      contains the prompt, source, mode, roster, and provider — the
 *      contract the React app (`useLedgerStream`) decodes on connect.
 *
 * Why this is server-only and not Playwright:
 *   The kanban UI is a thin renderer over the JSONL ledger — the seed
 *   step writes to a jotai store with no network round-trip
 *   (App.tsx:285) and the "Run" button hits `/api/run` directly. The
 *   load-bearing contract for "did the happy path survive a release
 *   build" lives in those two HTTP routes plus the SSE replay; a
 *   browser-driven test would add ~30 s of cold-start without catching
 *   any new failure modes.
 *
 * Why we keep dispatch disabled by default:
 *   The dispatcher spawns a real CLI binary (claude-code-cli /
 *   codex-cli / opencode-go). CI runners almost never have any of
 *   those on PATH, so leaving it enabled means the test would either
 *   flake on ENOENT timing or silently degrade to "we proved the
 *   ENOENT path works". `APOHARA_DISPATCH_DISABLED=1` keeps the smoke
 *   honest: we prove `/api/run` returns the contract, the ledger lands
 *   on disk, and the SSE replay matches — everything past that is
 *   provider-CLI behavior covered by `tests/core/dispatch/*` with
 *   mocked binaries.
 *
 * Gating:
 *   - `APOHARA_SKIP_FRESH_MACHINE_SMOKE=1` — opt-out for minimal
 *     Rust-only runners where bun isn't on PATH.
 *   - Skipped on Windows: the child-process kill semantics differ
 *     enough that the cleanup step flakes; cross-platform server boot
 *     is the job of the cross-platform CI matrix (G7.E.4), not of this
 *     bun:test suite.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const SERVER_ENTRY = resolve(REPO_ROOT, "packages/desktop/src/server.ts");
const SKIP =
	process.env.APOHARA_SKIP_FRESH_MACHINE_SMOKE === "1" ||
	process.platform === "win32";

// Random ephemeral port — 49152-65535 per IANA. Picked at module load
// so each describe block sees a fresh port and parallel test runs
// don't collide on 7331 (the dev default).
function pickPort(): number {
	return 49152 + Math.floor(Math.random() * (65535 - 49152));
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown = null;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/api/health`);
			if (r.ok) {
				const body = (await r.json()) as { ok?: boolean };
				if (body.ok) return;
			}
		} catch (err) {
			lastErr = err;
		}
		await new Promise((res) => setTimeout(res, 100));
	}
	throw new Error(
		`server on ${port} never reported /api/health ok within ${timeoutMs}ms` +
			(lastErr ? ` — last error: ${(lastErr as Error).message}` : ""),
	);
}

/**
 * Read the SSE stream until either `predicate` returns truthy on one of
 * the decoded `data:` frames or the deadline expires. Returns the
 * matching frame.
 *
 * EventSource isn't available in Bun's test runtime, so we drive the
 * fetch body directly. The server framing is `data: <json>\n\n` with
 * optional `id:` lines and `: heartbeat` comments — split on `\n\n`,
 * skip comment frames, parse JSON from the `data:` line.
 */
async function readSseUntil<T = unknown>(
	url: string,
	predicate: (frame: T) => boolean,
	timeoutMs: number,
	abortController: AbortController,
): Promise<T> {
	const response = await fetch(url, { signal: abortController.signal });
	if (!response.ok || !response.body) {
		throw new Error(`SSE connect failed: ${response.status}`);
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let sep: number;
		while ((sep = buffer.indexOf("\n\n")) !== -1) {
			const frame = buffer.slice(0, sep);
			buffer = buffer.slice(sep + 2);
			const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
			if (!dataLine) continue;
			const payload = dataLine.slice("data: ".length);
			let parsed: T;
			try {
				parsed = JSON.parse(payload) as T;
			} catch {
				continue;
			}
			if (predicate(parsed)) {
				return parsed;
			}
		}
	}
	throw new Error(`SSE stream never matched predicate within ${timeoutMs}ms`);
}

interface RunningServer {
	child: Subprocess;
	port: number;
	repoRoot: string;
	stop: () => Promise<void>;
}

async function startServer(): Promise<RunningServer> {
	const port = pickPort();
	const repoRoot = await mkdtemp(join(tmpdir(), "apohara-fresh-machine-"));
	const child = Bun.spawn({
		cmd: ["bun", "run", SERVER_ENTRY],
		cwd: REPO_ROOT,
		env: {
			...process.env,
			APOHARA_DESKTOP_PORT: String(port),
			APOHARA_REPO_ROOT: repoRoot,
			APOHARA_DISPATCH_DISABLED: "1",
			APOHARA_HOOKS_DISABLED: "1",
			APOHARA_RECONCILER_INTERVAL_MS: "0",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	try {
		await waitForHealth(port, 15_000);
	} catch (err) {
		// Drain stderr so the failure message includes the server's own
		// reason for not coming up (missing module, port in use, etc.).
		const stderr = await new Response(child.stderr).text().catch(() => "");
		const stdout = await new Response(child.stdout).text().catch(() => "");
		child.kill();
		throw new Error(
			`server failed to start on ${port}:\n` +
				`${(err as Error).message}\n` +
				`stdout: ${stdout.slice(-2000)}\n` +
				`stderr: ${stderr.slice(-2000)}`,
		);
	}
	return {
		child,
		port,
		repoRoot,
		stop: async () => {
			child.kill();
			await child.exited.catch(() => {});
			await rm(repoRoot, { recursive: true, force: true }).catch(() => {});
		},
	};
}

describe.skipIf(SKIP)("G7.E.1 — fresh-machine smoke", () => {
	let server: RunningServer | null = null;

	beforeEach(async () => {
		server = await startServer();
	});

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
	});

	test(
		"npx apohara → /api/run → SSE replay carries session_started",
		async () => {
			const { port } = server!;

			// 1. Liveness — same shape the README quickstart instructs users
			//    to verify (`curl localhost:7331/api/health`).
			const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
			expect(healthRes.status).toBe(200);
			const health = (await healthRes.json()) as {
				ok: boolean;
				port: number;
				mode: "gpu" | "cloud";
				eventsDir: string;
			};
			expect(health.ok).toBe(true);
			expect(health.port).toBe(port);
			expect(["gpu", "cloud"]).toContain(health.mode);
			expect(health.eventsDir).toContain(".events");

			// 2. Submit a prompt — the UI's "Run" button effectively does this
			//    POST with the user's current prompt + roster.
			const prompt = "Print hello world (smoke)";
			const roster = ["claude-code-cli"];
			const runRes = await fetch(`http://127.0.0.1:${port}/api/run`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt, roster, mode: "cloud" }),
			});
			expect(runRes.status).toBe(200);
			const runBody = (await runRes.json()) as {
				sessionId: string;
				ledger: string;
				provider: string;
				mode: "gpu" | "cloud";
				roster: string[];
			};
			expect(runBody.sessionId).toMatch(/^desktop-[0-9a-f]{32}$/);
			expect(runBody.ledger).toContain(`run-${runBody.sessionId}.jsonl`);
			expect(runBody.provider).toBe("claude-code-cli");
			expect(runBody.mode).toBe("cloud");
			expect(runBody.roster).toEqual(roster);

			// 3. SSE replay — connect and wait for the `session_started` line.
			//    The replay also exercises the path-validation guard on
			//    `/api/session/:id/events` (server.ts:812) since the UUID
			//    sessionId is the literal we feed back into the URL.
			interface LedgerEvent {
				type: string;
				payload: {
					prompt?: string;
					source?: string;
					mode?: "gpu" | "cloud";
					roster?: string[];
					provider?: string;
				};
			}
			const abort = new AbortController();
			try {
				const sessionStarted = await readSseUntil<LedgerEvent>(
					`http://127.0.0.1:${port}/api/session/${runBody.sessionId}/events`,
					(ev) => ev.type === "session_started",
					10_000,
					abort,
				);
				expect(sessionStarted.payload.prompt).toBe(prompt);
				expect(sessionStarted.payload.source).toBe("desktop");
				expect(sessionStarted.payload.mode).toBe("cloud");
				expect(sessionStarted.payload.roster).toEqual(roster);
				expect(sessionStarted.payload.provider).toBe("claude-code-cli");
			} finally {
				abort.abort();
			}
		},
		30_000,
	);

	test("path-traversal sessionId on SSE rejects 400", async () => {
		const { port } = server!;
		// Inline coverage of the security guard at server.ts:812 — a
		// sibling smoke that prevents a regression where the SSE handler
		// would let a malformed id escape `EVENTS_DIR`.
		const res = await fetch(
			`http://127.0.0.1:${port}/api/session/..%2Fevil/events`,
		);
		expect(res.status).toBe(400);
		await res.body?.cancel();
	});
});
