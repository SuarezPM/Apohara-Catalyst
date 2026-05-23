/**
 * G7.5.A.5 — Wire BlockedReason classifier en protocol events.
 *
 * Sprint 5 G5.B.3 entregó `BlockedReason` + `classifyBlocked` en
 * `src/core/dispatch/state.ts`, pero ningún consumidor llamaba al
 * classifier. Provider events seguían atravesando el sistema sin
 * etiqueta de razón → la state machine no podía decidir retry
 * inteligente (¿permiso? ¿auth? ¿rate-limit?).
 *
 * Esta tarea cierra el wiring:
 *
 *   1. `ProtocolEvent` admite un variant `kind: "blocked"` que carga
 *      el payload original (label / reason / priorInputRequestAt). Los
 *      drivers per-provider emiten este variant cuando detectan una
 *      condición que bloquea — el provider concreto ya conoce el
 *      vocabulario del CLI (Claude / Codex / OpenCode) y traduce a
 *      `BlockingEvent` antes de pasarlo upstream.
 *
 *   2. `protocolEventToBlocking(ev)` mapea un `ProtocolEvent` a un
 *      `BlockingEvent | null`. Cubre el variant `blocked` (passthrough)
 *      y el legacy `permission_request` (traduce a `approval_required`).
 *
 *   3. `classifyProtocolEvent(ev)` combina ambos: ev → BlockingEvent →
 *      classifyBlocked → BlockedSnapshot. Devuelve `null` para eventos
 *      no bloqueantes.
 *
 *   4. `transitionToBlocked(snapshot)` construye un `RunTransition`
 *      tagged con `state: "blocked"` y `blockedReason` específico. Es
 *      el shape que el dispatcher consume para parquear la task.
 */
import { expect, test } from "bun:test";
import {
	classifyProtocolEvent,
	transitionToBlocked,
	type ProtocolEvent,
} from "../../src/core/providers/protocols/AgentProtocol";
import type { BlockedReason, RunTransition } from "../../src/core/dispatch/state";

test("classifyProtocolEvent: blocked variant with permission_request payload → approval_required", () => {
	const ev: ProtocolEvent = {
		kind: "blocked",
		event: { kind: "permission_request", label: "Approve write to /etc/passwd" },
	};
	const snap = classifyProtocolEvent(ev);
	expect(snap).not.toBeNull();
	expect(snap?.reason).toBe<BlockedReason>("approval_required");
	expect(snap?.detail).toBe("Approve write to /etc/passwd");
});

test("classifyProtocolEvent: blocked variant with provider_rejected payload → provider_rejected", () => {
	const ev: ProtocolEvent = {
		kind: "blocked",
		event: { kind: "provider_rejected", reason: "auth expired" },
	};
	const snap = classifyProtocolEvent(ev);
	expect(snap?.reason).toBe<BlockedReason>("provider_rejected");
	expect(snap?.detail).toBe("auth expired");
});

test("classifyProtocolEvent: blocked variant with user_input_required → user_input_required", () => {
	const ev: ProtocolEvent = {
		kind: "blocked",
		event: { kind: "user_input_required", label: "Paste API key" },
	};
	const snap = classifyProtocolEvent(ev);
	expect(snap?.reason).toBe<BlockedReason>("user_input_required");
});

test("classifyProtocolEvent: legacy permission_request variant still classifies as approval_required", () => {
	// Backwards-compat: ProtocolEvent ya tenía `permission_request` antes
	// de G7.5.A.5. El wiring debe seguir clasificándolo correctamente para
	// no romper drivers que aún no migraron al variant `blocked`.
	const ev: ProtocolEvent = {
		kind: "permission_request",
		toolName: "Bash",
		input: { command: "rm -rf /" },
	};
	const snap = classifyProtocolEvent(ev);
	expect(snap?.reason).toBe<BlockedReason>("approval_required");
	expect(snap?.detail).toContain("Bash");
});

test("classifyProtocolEvent: non-blocking events return null", () => {
	const nonBlocking: ProtocolEvent[] = [
		{ kind: "text", content: "hola", turn: 0 },
		{ kind: "tool_call", toolName: "Read", toolInput: {}, toolCallId: "x" },
		{ kind: "complete", reason: "finished" },
	];
	for (const ev of nonBlocking) {
		expect(classifyProtocolEvent(ev)).toBeNull();
	}
});

test("transitionToBlocked: produces RunTransition con BlockedReason específico", () => {
	const snap = classifyProtocolEvent({
		kind: "blocked",
		event: { kind: "permission_request", label: "Approve fs write" },
	});
	expect(snap).not.toBeNull();
	const trans: RunTransition = transitionToBlocked(snap!);
	expect(trans.state).toBe("blocked");
	expect(trans.blockedReason).toBe<BlockedReason>("approval_required");
	expect(trans.blockedSince).toBe(snap!.since);
});

test("integration: provider event → classifier → state transition (end-to-end)", () => {
	// Pipeline completo: un driver emite un ProtocolEvent con kind: "blocked"
	// y payload provider_rejected; el handler clasifica; el resultado se
	// envuelve en una RunTransition que el dispatcher puede consumir.
	const providerEvent: ProtocolEvent = {
		kind: "blocked",
		event: { kind: "provider_rejected", reason: "rate-limited 429" },
	};
	const snap = classifyProtocolEvent(providerEvent);
	expect(snap).not.toBeNull();
	const trans = transitionToBlocked(snap!);
	expect(trans).toEqual({
		state: "blocked",
		blockedReason: "provider_rejected",
		blockedSince: snap!.since,
		detail: "rate-limited 429",
	});
});
