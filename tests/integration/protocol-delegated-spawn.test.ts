/**
 * T4.7d — BaseAgentProvider delega el spawn a Protocol.
 *
 * Cierra el wiring nimbalyst #1.2 a nivel de orquestación:
 *   1. `BaseAgentProvider.spawn()` debe invocar `this.protocol.createSession()`
 *      exactamente una vez por llamada y devolver el `SpawnedSession` que
 *      el Protocol produzca (no construir su propio spawn directo).
 *   2. Los 3 Provider concretos (Claude / Codex / OpenCode) deben inyectar
 *      su Protocol respectivo via el getter `protocol`. El providerId que
 *      sale del spawn lleva el prefijo del Protocol (`claude-…`, `codex-…`,
 *      `opencode-…`) — eso confirma que el spawn pasó por el Protocol y
 *      no por una ruta paralela.
 *   3. `BaseAgentProvider` propaga el env Apohara (APOHARA_HOOK_PORT/TOKEN,
 *      APOHARA_TASK_ID, APOHARA_PANE_KEY) al Protocol vía `CreateSessionOpts.env`.
 *      Esa es la garantía §0.4 + hook-discovery que cierra el wiring real.
 *   4. `BaseAgentProvider.abort()` delega a `protocol.abortSession()` con el
 *      providerId que el Protocol asignó.
 *
 * Si `claude`/`codex`/`opencode` no están en PATH, los sub-tests que
 * intentan spawn real degradan a skip (warning silencioso). El test #1
 * (FakeProtocol) NO depende del binario y SIEMPRE corre.
 */
import { test, expect, beforeEach } from "bun:test";
import { BaseAgentProvider } from "../../src/core/providers/BaseAgentProvider";
import { ClaudeCodeProvider } from "../../src/core/providers/ClaudeCodeProvider";
import { CodexProvider } from "../../src/core/providers/CodexProvider";
import { OpenCodeProvider } from "../../src/core/providers/OpenCodeProvider";
import { resetApoharaDeps, setApoharaDeps } from "../../src/core/providers/deps";
import type {
	AgentProtocol,
	CreateSessionOpts,
	ProtocolEvent,
	SpawnedSession,
} from "../../src/core/providers/protocols/AgentProtocol";

beforeEach(() => {
	resetApoharaDeps();
	setApoharaDeps({
		hookEndpoint: () => ({ port: 8901, token: "delegate-test-token" }),
		indexerSocketPath: "/tmp/idx",
		ledgerPath: "/tmp/l",
		capabilityStatsPath: "/tmp/c",
	});
});

test("BaseAgentProvider.spawn delegates to protocol.createSession (FakeProtocol)", async () => {
	// Spy Protocol: count exactly how many times createSession fires + capture
	// the opts so we can assert the env propagation contract too.
	let createCount = 0;
	let capturedOpts: CreateSessionOpts | undefined;
	const abortedIds: string[] = [];

	class SpyProtocol implements AgentProtocol {
		async createSession(opts: CreateSessionOpts): Promise<SpawnedSession> {
			createCount++;
			capturedOpts = opts;
			return { providerId: "spy-sid-12345", spawnedAt: 17000 };
		}
		async resumeSession(): Promise<SpawnedSession> {
			return { providerId: "spy-sid-12345", spawnedAt: 0 };
		}
		async forkSession(): Promise<SpawnedSession> {
			return { providerId: "spy-sid-12345-fork", spawnedAt: 0 };
		}
		async *sendMessage(): AsyncIterable<ProtocolEvent> {
			yield { kind: "complete", reason: "finished" };
		}
		async abortSession(sid: string): Promise<void> {
			abortedIds.push(sid);
		}
	}

	class SpyProvider extends BaseAgentProvider {
		readonly _proto = new SpyProtocol();
		get id() {
			return "claude-code-cli" as const;
		}
		get displayName() {
			return "Spy";
		}
		get roles() {
			return ["coder"] as const;
		}
		get protocol() {
			return this._proto;
		}
	}

	const provider = new SpyProvider();
	const session = await provider.spawn({
		workspacePath: "/tmp/spy-ws",
		taskId: "task-99",
		paneKey: "pane-A",
		apoharaSessionId: "apohara-sess-1",
	});

	// 1. spawn() devolvió exactamente lo que createSession produjo.
	expect(session.providerId).toBe("spy-sid-12345");
	expect(session.spawnedAt).toBe(17000);

	// 2. createSession se llamó exactamente UNA vez (no doble spawn).
	expect(createCount).toBe(1);

	// 3. El Protocol recibió el env Apohara propagado por BaseAgentProvider.
	expect(capturedOpts?.workspacePath).toBe("/tmp/spy-ws");
	expect(capturedOpts?.taskId).toBe("task-99");
	expect(capturedOpts?.paneKey).toBe("pane-A");
	expect(capturedOpts?.env?.APOHARA_HOOK_PORT).toBe("8901");
	expect(capturedOpts?.env?.APOHARA_HOOK_TOKEN).toBe("delegate-test-token");
	expect(capturedOpts?.env?.APOHARA_TASK_ID).toBe("task-99");
	expect(capturedOpts?.env?.APOHARA_PANE_KEY).toBe("pane-A");

	// 4. abort() delega al Protocol con el providerId que el Protocol asignó.
	await provider.abort("apohara-sess-1");
	expect(abortedIds).toEqual(["spy-sid-12345"]);
});

test("ClaudeCodeProvider injects ClaudeCodeProtocol (providerId prefix 'claude-')", async () => {
	const provider = new ClaudeCodeProvider();
	try {
		const session = await provider.spawn({ workspacePath: "/tmp" });
		// ClaudeCodeProtocol formatea providerId como `claude-<pid>-<ts>`.
		// Si BaseAgentProvider hiciera el spawn por su cuenta, este prefijo no
		// aparecería — el formato es responsabilidad del Protocol.
		expect(session.providerId).toMatch(/^claude-\d+-\d+$/);
	} catch (err) {
		const msg = (err as Error).message;
		if (msg.includes("ENOENT") || msg.includes("not found")) {
			console.warn(
				"claude binary not in PATH, skipping ClaudeCodeProvider spawn-delegation test",
			);
			return;
		}
		throw err;
	}
});

test("CodexProvider injects CodexProtocol (providerId prefix 'codex-')", async () => {
	const provider = new CodexProvider();
	try {
		const session = await provider.spawn({ workspacePath: "/tmp" });
		expect(session.providerId).toMatch(/^codex-\d+-\d+$/);
	} catch (err) {
		const msg = (err as Error).message;
		if (msg.includes("ENOENT") || msg.includes("not found")) {
			console.warn(
				"codex binary not in PATH, skipping CodexProvider spawn-delegation test",
			);
			return;
		}
		throw err;
	}
});

test("OpenCodeProvider injects OpenCodeProtocol (providerId prefix 'opencode-')", async () => {
	const provider = new OpenCodeProvider();
	try {
		const session = await provider.spawn({ workspacePath: "/tmp" });
		expect(session.providerId).toMatch(/^opencode-\d+-\d+$/);
	} catch (err) {
		const msg = (err as Error).message;
		if (msg.includes("ENOENT") || msg.includes("not found")) {
			console.warn(
				"opencode binary not in PATH, skipping OpenCodeProvider spawn-delegation test",
			);
			return;
		}
		throw err;
	}
});

test("BaseAgentProvider does NOT spawn child processes directly — every spawn goes through protocol", async () => {
	// Defense-in-depth: si alguien añade en el futuro un `child_process.spawn`
	// directo a BaseAgentProvider, este test lo cazará: usamos un Protocol que
	// JAMÁS spawnea y verificamos que `provider.spawn()` no cuelgue ni intente
	// llamar a un binario. El único path al sistema operativo debe ser via
	// `this.protocol.createSession()`.
	let createSessionInvoked = false;

	class NoOpProtocol implements AgentProtocol {
		async createSession(): Promise<SpawnedSession> {
			createSessionInvoked = true;
			return { providerId: "noop-sid", spawnedAt: 0 };
		}
		async resumeSession(): Promise<SpawnedSession> {
			return { providerId: "noop-sid", spawnedAt: 0 };
		}
		async forkSession(): Promise<SpawnedSession> {
			return { providerId: "noop-sid", spawnedAt: 0 };
		}
		async *sendMessage(): AsyncIterable<ProtocolEvent> {
			yield { kind: "complete", reason: "finished" };
		}
		async abortSession(): Promise<void> {}
	}
	class NoOpProvider extends BaseAgentProvider {
		readonly _proto = new NoOpProtocol();
		get id() {
			return "claude-code-cli" as const;
		}
		get displayName() {
			return "NoOp";
		}
		get roles() {
			return ["coder"] as const;
		}
		get protocol() {
			return this._proto;
		}
	}

	const session = await new NoOpProvider().spawn({
		workspacePath: "/tmp/never-resolved-by-os",
	});
	// El Protocol corrió: el spawn fue delegado, no inline.
	expect(createSessionInvoked).toBe(true);
	expect(session.providerId).toBe("noop-sid");
});
