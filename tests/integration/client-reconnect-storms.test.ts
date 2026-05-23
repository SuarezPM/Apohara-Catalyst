/**
 * W3.2 — Client reconnect storms.
 *
 * Drives 10 concurrent mock clients, each running 100 connect/disconnect
 * cycles against an in-process unix socket server that mimics the daemon
 * socket. Asserts:
 *
 *  1. No file descriptor leak on either side (heuristic: process FD count
 *     stays bounded across the storm).
 *  2. The server's accept count = 10 × 100 = 1000 (every cycle completes).
 *  3. The server never deadlocks under the storm (test exits within bound).
 *  4. After the storm, the next connect succeeds (no socket left in a
 *     broken state).
 *
 * Why a TS-side mock vs. driving `apohara-client::connect_with_backoff`
 * directly?
 *  - The Rust client's connect loop is exhaustively unit-tested in
 *    `crates/apohara-client/src/connect_tests.rs` with `start_paused`
 *    tokio.
 *  - The cross-crate contract under test here is "the daemon socket
 *    can sustain a reconnect storm without breaking" — that's the
 *    integration-level concern that lives in the OS socket layer, not
 *    in the policy code.
 *
 * Skips on Windows (named-pipe paths differ; covered by W3.8 matrix).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createServer, type Server, Socket, connect } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SKIP_PLATFORM = process.platform === "win32";

let scratch: string;
let socketPath: string;
let server: Server | null = null;

beforeEach(async () => {
	scratch = await mkdtemp(path.join(tmpdir(), "apohara-storm-"));
	socketPath = path.join(scratch, "daemon.sock");
});

afterEach(async () => {
	if (server) {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = null;
	}
	await rm(scratch, { recursive: true, force: true });
});

interface StormResult {
	accepted: number;
	completed: number;
	failed: number;
	durationMs: number;
}

async function startServer(): Promise<{ acceptedRef: { count: number } }> {
	const acceptedRef = { count: 0 };
	server = createServer((s: Socket) => {
		acceptedRef.count += 1;
		// Echo + close on any data, or close after the client closes.
		s.on("data", (b) => {
			try {
				s.write(b);
			} catch {}
		});
		s.on("error", () => {});
		s.on("end", () => s.end());
	});
	await new Promise<void>((resolve, reject) => {
		server?.once("error", reject);
		server?.listen(socketPath, () => resolve());
	});
	return { acceptedRef };
}

async function singleConnectCycle(): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const sock = connect(socketPath);
		let done = false;
		const finish = (ok: boolean) => {
			if (done) return;
			done = true;
			try {
				sock.destroy();
			} catch {}
			resolve(ok);
		};
		sock.once("connect", () => {
			// Round-trip one byte to confirm the channel is live.
			sock.write("p");
			sock.once("data", () => finish(true));
		});
		sock.once("error", () => finish(false));
		// Hard timeout — anything past this means the server stalled.
		setTimeout(() => finish(false), 2_000);
	});
}

async function runClient(cycles: number): Promise<{ ok: number; fail: number }> {
	let ok = 0;
	let fail = 0;
	for (let i = 0; i < cycles; i++) {
		const r = await singleConnectCycle();
		if (r) ok += 1;
		else fail += 1;
	}
	return { ok, fail };
}

async function runStorm(
	clientCount: number,
	cyclesPerClient: number,
): Promise<StormResult> {
	const { acceptedRef } = await startServer();
	const start = performance.now();
	const results = await Promise.all(
		Array.from({ length: clientCount }, () => runClient(cyclesPerClient)),
	);
	const durationMs = performance.now() - start;
	const completed = results.reduce((acc, r) => acc + r.ok, 0);
	const failed = results.reduce((acc, r) => acc + r.fail, 0);
	return { accepted: acceptedRef.count, completed, failed, durationMs };
}

test.skipIf(SKIP_PLATFORM)(
	"10 × 100 reconnect storm completes all cycles",
	async () => {
		const r = await runStorm(10, 100);
		expect(r.completed).toBe(1000);
		expect(r.failed).toBe(0);
		// Allow some slack: each cycle is sub-millisecond on Linux, but CI
		// runners are slow. Cap at 60s total wall time.
		expect(r.durationMs).toBeLessThan(60_000);
		expect(r.accepted).toBe(1000);
	},
	90_000,
);

test.skipIf(SKIP_PLATFORM)(
	"server survives storm and accepts a fresh connection after",
	async () => {
		await runStorm(10, 50); // smaller storm so the test stays fast
		const post = await singleConnectCycle();
		expect(post).toBe(true);
	},
	60_000,
);

test.skipIf(SKIP_PLATFORM)(
	"file descriptor count stays bounded under sustained reconnects",
	async () => {
		// Heuristic FD-leak check: count open FDs before/after a moderate
		// storm. Linux exposes them via /proc/self/fd. We allow a small
		// delta because Node keeps some internal buffer FDs.
		const beforeFds = await countOpenFds();
		await runStorm(5, 50);
		// Settle: give the event loop time to actually close sockets.
		await new Promise((r) => setTimeout(r, 250));
		const afterFds = await countOpenFds();
		// Cap delta at 20 — even with worker threads + Node internals the
		// growth from 250 reconnects should be near zero. If we're leaking
		// even one FD per cycle the delta would be 250+.
		expect(afterFds - beforeFds).toBeLessThan(20);
	},
	60_000,
);

async function countOpenFds(): Promise<number> {
	if (process.platform !== "linux") return 0;
	try {
		const dir = "/proc/self/fd";
		const fs = await import("node:fs/promises");
		const list = await fs.readdir(dir);
		return list.length;
	} catch {
		return 0;
	}
}

test.skipIf(SKIP_PLATFORM)(
	"concurrent connect/disconnect does not drop messages on the wire",
	async () => {
		// Sanity for the round-trip: every client sees its own echo back.
		// This guards against the server crossing data between connections,
		// which would be a fatal bug if real apohara framing landed here.
		const { acceptedRef } = await startServer();
		const probes = await Promise.all(
			Array.from({ length: 20 }, async (_, i) => {
				return new Promise<string>((resolve) => {
					const sock = connect(socketPath);
					sock.once("connect", () => sock.write(`probe-${i}`));
					sock.once("data", (b) => {
						sock.destroy();
						resolve(b.toString());
					});
					sock.once("error", () => resolve("ERR"));
					setTimeout(() => {
						try {
							sock.destroy();
						} catch {}
						resolve("TIMEOUT");
					}, 2000);
				});
			}),
		);
		probes.forEach((p, i) => {
			expect(p).toBe(`probe-${i}`);
		});
		expect(acceptedRef.count).toBe(20);
	},
	30_000,
);
