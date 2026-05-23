/**
 * Pre/PostCompact contract re-injection — G5.C.1 (claude-octopus #8).
 *
 * Context compaction is destructive: when an agent decides its context window
 * is approaching the limit, it summarizes / drops earlier turns. Anything the
 * agent learned in those turns is gone unless we explicitly recover it.
 *
 * The contract pattern (claude-octopus): before compaction, snapshot the
 * load-bearing pieces the agent must keep across the boundary (active plan
 * IDs, the task we're working, trust preset / settings, free-form notes).
 * After compaction, re-inject the snapshot as `additionalContext` in the
 * next prompt envelope so the post-compact agent picks up where it left off.
 *
 * This module is a pure in-memory hold-and-yield buffer keyed by sessionId.
 * The hook event bridge wires it up to the wire protocol:
 *
 *   - `pre_compact` event → `capture(snapshot)` stores the contract.
 *   - `post_compact` event → `renderAdditionalContext(sessionId)` returns the
 *     envelope to merge into the next user_prompt_submit; `consume` clears it.
 *
 * Spec §3.5.1 describes the lifecycle. Snapshots are per-session and ephemeral
 * — losing them on process restart is fine (the post-compact event won't fire
 * anyway because the agent that triggered it is also gone).
 */

export interface ContractSnapshot {
	sessionId: string;
	capturedAt: number;
	activePlanIds: string[];
	activeTaskId: string | null;
	settings: Record<string, unknown>;
	notes?: string;
}

export interface AdditionalContextEnvelope {
	additionalContext: string;
	snapshot: ContractSnapshot;
}

export type CompactHookEvent =
	| {
			type: "pre_compact";
			sessionId: string;
			contract: Omit<ContractSnapshot, "sessionId" | "capturedAt">;
			timestamp: number;
	  }
	| { type: "post_compact"; sessionId: string; timestamp: number };

export type HookOutcome =
	| { action: "captured" }
	| { action: "reinjected"; additionalContext: string; snapshot: ContractSnapshot }
	| { action: "noop" }
	| { action: "ignored" };

export class CompactReinjector {
	private snapshots = new Map<string, ContractSnapshot>();

	capture(snapshot: ContractSnapshot): void {
		this.snapshots.set(snapshot.sessionId, snapshot);
	}

	/**
	 * Pop the snapshot for sessionId (destructive). Returns null when none.
	 */
	consume(sessionId: string): ContractSnapshot | null {
		const s = this.snapshots.get(sessionId);
		if (!s) return null;
		this.snapshots.delete(sessionId);
		return s;
	}

	/**
	 * Render the snapshot as an `additionalContext` envelope ready to merge
	 * into the next `user_prompt_submit` payload. Destructive — calling this
	 * removes the snapshot from the buffer (the post-compact agent should
	 * only see the re-injection ONCE).
	 */
	renderAdditionalContext(
		sessionId: string,
	): AdditionalContextEnvelope | null {
		const snap = this.consume(sessionId);
		if (!snap) return null;
		const lines = [
			"### Post-compaction contract re-injection",
			"",
			`Session: ${snap.sessionId}`,
			`Captured at: ${new Date(snap.capturedAt).toISOString()}`,
			`Active task: ${snap.activeTaskId ?? "(none)"}`,
			`Active plans: ${snap.activePlanIds.length === 0 ? "(none)" : snap.activePlanIds.join(", ")}`,
			`Settings: ${JSON.stringify(snap.settings)}`,
		];
		if (snap.notes) {
			lines.push("", `Notes: ${snap.notes}`);
		}
		return {
			additionalContext: lines.join("\n"),
			snapshot: snap,
		};
	}

	/**
	 * Wire-protocol entry point: takes a `pre_compact` or `post_compact` hook
	 * event and either captures or re-injects. Unrelated event types return
	 * `{ action: "ignored" }` so the central hook event dispatcher can call
	 * this unconditionally.
	 */
	onHookEvent(event: CompactHookEvent): HookOutcome {
		if (event.type === "pre_compact") {
			this.capture({
				sessionId: event.sessionId,
				capturedAt: event.timestamp,
				activePlanIds: event.contract.activePlanIds,
				activeTaskId: event.contract.activeTaskId,
				settings: event.contract.settings,
				notes: event.contract.notes,
			});
			return { action: "captured" };
		}
		if (event.type === "post_compact") {
			const env = this.renderAdditionalContext(event.sessionId);
			if (!env) return { action: "noop" };
			return {
				action: "reinjected",
				additionalContext: env.additionalContext,
				snapshot: env.snapshot,
			};
		}
		return { action: "ignored" };
	}
}
