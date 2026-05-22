import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHooksServer } from "../../../src/core/hooks-server/server";

let tmp: string;
let originalHome: string | undefined;

beforeEach(async () => {
	originalHome = process.env.HOME;
	tmp = await mkdtemp(join(tmpdir(), "apohara-hooks-test-"));
	process.env.HOME = tmp;
});
afterEach(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(tmp, { recursive: true, force: true });
});

test("hooks-server health endpoint is alive", async () => {
	const srv = await startHooksServer();
	try {
		const r = await fetch(`http://127.0.0.1:${srv.port}/health`);
		expect(r.status).toBe(200);
		const body = await r.json();
		expect(body.alive).toBe(true);
	} finally {
		await srv.stop();
	}
});

test("hooks-server publishes endpoint file under HOME", async () => {
	const srv = await startHooksServer();
	try {
		expect(srv.endpointFile).toBe(
			join(tmp, ".apohara", "agent-hooks", "endpoint.json"),
		);
		const body = JSON.parse(await readFile(srv.endpointFile!, "utf-8"));
		expect(body.port).toBe(srv.port);
		expect(body.token).toBe(srv.token);
	} finally {
		await srv.stop();
	}
});

test("hooks-server /event rejects missing bearer", async () => {
	const srv = await startHooksServer();
	try {
		const r = await fetch(`http://127.0.0.1:${srv.port}/event`, {
			method: "POST",
			body: JSON.stringify({ type: "pre_tool_use" }),
		});
		expect(r.status).toBe(401);
	} finally {
		await srv.stop();
	}
});

test("hooks-server /event accepts valid bearer and invokes onEvent", async () => {
	const seen: unknown[] = [];
	const srv = await startHooksServer({
		onEvent: (event) => {
			seen.push(event);
		},
	});
	try {
		const r = await fetch(`http://127.0.0.1:${srv.port}/event`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${srv.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ type: "pre_tool_use", tool: "bash" }),
		});
		expect(r.status).toBe(200);
		expect(seen).toHaveLength(1);
		expect((seen[0] as Record<string, unknown>).type).toBe("pre_tool_use");
	} finally {
		await srv.stop();
	}
});

test("hooks-server /event rejects payload missing type", async () => {
	const srv = await startHooksServer();
	try {
		const r = await fetch(`http://127.0.0.1:${srv.port}/event`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${srv.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ foo: "bar" }),
		});
		expect(r.status).toBe(422);
	} finally {
		await srv.stop();
	}
});

test("hooks-server /event enforces 256 KiB body cap", async () => {
	const srv = await startHooksServer();
	try {
		const big = "x".repeat(300 * 1024);
		const r = await fetch(`http://127.0.0.1:${srv.port}/event`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${srv.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ type: "pre_tool_use", big }),
		});
		expect(r.status).toBe(413);
	} finally {
		await srv.stop();
	}
});
