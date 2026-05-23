/**
 * G7.5.A.3 — SSE state stream with JSON-Patch (RFC 6902) wiring.
 *
 * Sprint 5 G5.F.3 delivered `diffPatch` + `applyPatch` in
 * `src/core/projector/json-patch-stream.ts`. They had zero consumers.
 * This task wires them into the desktop SSE path: instead of the client
 * re-folding the entire ledger on every new event (via
 * `projectToUiCards` in TaskBoard's `useMemo`), the server now emits
 *
 *   - one `state-init` event with the full projected state on connect, and
 *   - one `state-patch` event per ledger append, carrying only the
 *     RFC-6902 ops between the previous and current projection.
 *
 * Bandwidth + render churn drop linearly with ledger size: a 1k-event
 * session that flipped a single card previously re-streamed all 1k
 * events; now it streams ~1 patch op.
 *
 * Pins:
 *  1. Round-trip: `applyPatch(prev, diffPatch(prev, next)) === next` for
 *     realistic UI-card states (already covered in
 *     `tests/core/projector/json-patch-stream.test.ts` for primitives —
 *     here we exercise the realistic `UiTaskCard` map shape end-to-end).
 *  2. Server file pin: `packages/desktop/src/server.ts` imports
 *     `diffPatch` from `json-patch-stream` and registers a route that
 *     emits the named `state-init` / `state-patch` events.
 *  3. Client listener pin: `packages/desktop/src/store/listeners/sseListener.ts`
 *     imports `applyPatch` and wires the two named events into a store
 *     update. Exporting the pure consumer lets the test exercise it
 *     without a DOM EventSource.
 *  4. Behavioral: feed the pure consumer a `state-init` + a `state-patch`
 *     in sequence, assert the store mirrors what the server would have
 *     projected from the equivalent ledger lines.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	applyPatch,
	diffPatch,
} from "../../src/core/projector/json-patch-stream";
import {
	projectLedgerToState,
	type ProjectedState,
} from "../../packages/desktop/src/server-projection";
import {
	consumeSseStateEvent,
	type SseStateEvent,
} from "../../packages/desktop/src/store/listeners/sseListener";
import type { EventLog } from "../../src/core/types";

const REPO_ROOT = resolve(import.meta.dir, "../..");

function mkEvent(over: Partial<EventLog>): EventLog {
	return {
		id: over.id ?? crypto.randomUUID(),
		timestamp: over.timestamp ?? new Date().toISOString(),
		type: over.type ?? "task_scheduled",
		severity: over.severity ?? "info",
		taskId: over.taskId,
		payload: over.payload ?? {},
		metadata: over.metadata,
	};
}

describe("G7.5.A.3 — diffPatch round-trip on realistic projected state", () => {
	test("diffPatch produces RFC-6902 ops between two projected states", () => {
		const before: ProjectedState = {
			tasks: {
				"task-A": {
					taskId: "task-A",
					status: "pending",
					providerId: "claude-code-cli",
				},
			},
		};
		const after: ProjectedState = {
			tasks: {
				"task-A": {
					taskId: "task-A",
					status: "completed",
					providerId: "claude-code-cli",
					result: "shipped",
					durationMs: 3000,
				},
			},
		};

		const patches = diffPatch(before, after);
		expect(patches.length).toBeGreaterThan(0);
		// Every op is RFC-6902 shape: { op, path, value? }
		for (const op of patches) {
			expect(["add", "replace", "remove"]).toContain(op.op);
			expect(op.path.startsWith("/")).toBe(true);
		}
	});

	test("applyPatch reverses diffPatch round-trip across add + replace", () => {
		const before: ProjectedState = {
			tasks: {
				"task-A": { taskId: "task-A", status: "pending" },
			},
		};
		const after: ProjectedState = {
			tasks: {
				"task-A": { taskId: "task-A", status: "completed" },
				"task-B": { taskId: "task-B", status: "failed", error: "boom" },
			},
		};

		const patch = diffPatch(before, after);
		const reconstructed = applyPatch(before, patch);
		expect(reconstructed).toEqual(after);
	});

	test("projectLedgerToState folds ledger into the canonical UI projection", () => {
		const events: EventLog[] = [
			mkEvent({
				type: "task_scheduled",
				taskId: "task-A",
				payload: { prompt: "ship A", providerId: "claude-code-cli" },
			}),
		];
		const initial = projectLedgerToState(events);
		expect(initial.tasks["task-A"]).toBeDefined();
		expect(initial.tasks["task-A"].status).toBe("pending");

		const more: EventLog[] = [
			...events,
			mkEvent({
				type: "task_completed",
				taskId: "task-A",
				payload: { content: "shipped" },
			}),
		];
		const final = projectLedgerToState(more);
		expect(final.tasks["task-A"].status).toBe("completed");

		// Verify the patch shape between the two projections is non-empty —
		// the whole point of the optimization.
		const ops = diffPatch(initial, final);
		expect(ops.length).toBeGreaterThan(0);
	});
});

describe("G7.5.A.3 — server wiring pin", () => {
	test("server.ts imports diffPatch and registers /api/session/:id/state route", () => {
		const serverSrc = readFileSync(
			resolve(REPO_ROOT, "packages/desktop/src/server.ts"),
			"utf8",
		);
		// Pin the canonical import — if someone tears it out, this fires.
		expect(serverSrc).toMatch(/diffPatch/);
		expect(serverSrc).toMatch(
			/from\s+["'].*core\/projector\/json-patch-stream/,
		);
		// Pin the new named-event SSE route. The exact path is part of the
		// public API the listener depends on.
		expect(serverSrc).toMatch(/\/api\/session\/:id\/state/);
		// Pin the named-event framing — the client distinguishes
		// state-init vs state-patch by SSE `event:` line. The framing
		// itself is generated by a `sendNamed("state-init", …)` / `…("state-patch", …)`
		// helper inside the route, so we pin the call sites directly.
		expect(serverSrc).toMatch(/sendNamed\(\s*["']state-init["']/);
		expect(serverSrc).toMatch(/sendNamed\(\s*["']state-patch["']/);
	});

	test("server-projection module exports the pure helper", () => {
		// The helper is what makes the server side unit-testable. If it
		// disappears the route may still work but the contract isn't pinned.
		const projSrc = readFileSync(
			resolve(REPO_ROOT, "packages/desktop/src/server-projection.ts"),
			"utf8",
		);
		expect(projSrc).toMatch(/export\s+function\s+projectLedgerToState/);
		expect(projSrc).toMatch(
			/from\s+["'].*core\/projector\/transcript-transformer/,
		);
	});
});

describe("G7.5.A.3 — client listener pin + behavior", () => {
	test("sseListener.ts imports applyPatch from json-patch-stream", () => {
		const listenerSrc = readFileSync(
			resolve(
				REPO_ROOT,
				"packages/desktop/src/store/listeners/sseListener.ts",
			),
			"utf8",
		);
		expect(listenerSrc).toMatch(/applyPatch/);
		expect(listenerSrc).toMatch(
			/from\s+["'].*core\/projector\/json-patch-stream/,
		);
	});

	test("consumeSseStateEvent hydrates from state-init", () => {
		const initial: ProjectedState = {
			tasks: { "task-A": { taskId: "task-A", status: "pending" } },
		};
		const init: SseStateEvent = { event: "state-init", state: initial };
		const next = consumeSseStateEvent(null, init);
		expect(next).toEqual(initial);
	});

	test("consumeSseStateEvent applies state-patch to the running state", () => {
		const initial: ProjectedState = {
			tasks: { "task-A": { taskId: "task-A", status: "pending" } },
		};
		const after: ProjectedState = {
			tasks: { "task-A": { taskId: "task-A", status: "completed" } },
		};
		const patch = diffPatch(initial, after);
		const evt: SseStateEvent = { event: "state-patch", patch };
		const next = consumeSseStateEvent(initial, evt);
		expect(next).toEqual(after);
	});

	test("consumeSseStateEvent end-to-end: init then patch matches direct projection", () => {
		// Server side: project ledger at t0, then again at t1, ship the
		// diff. Client side: apply init then patch, must equal direct
		// projection at t1.
		const t0Events: EventLog[] = [
			mkEvent({
				type: "task_scheduled",
				taskId: "task-A",
				payload: { prompt: "ship A", providerId: "claude-code-cli" },
			}),
		];
		const t1Events: EventLog[] = [
			...t0Events,
			mkEvent({
				type: "task_completed",
				taskId: "task-A",
				payload: { content: "shipped" },
			}),
		];
		const stateT0 = projectLedgerToState(t0Events);
		const stateT1 = projectLedgerToState(t1Events);
		const patch = diffPatch(stateT0, stateT1);

		const clientAfterInit = consumeSseStateEvent(null, {
			event: "state-init",
			state: stateT0,
		});
		const clientAfterPatch = consumeSseStateEvent(clientAfterInit, {
			event: "state-patch",
			patch,
		});

		expect(clientAfterPatch).toEqual(stateT1);
	});
});
