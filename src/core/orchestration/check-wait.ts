/**
 * `check --wait` primitive per spec §3.6.
 *
 * Blocks until a matching unread message arrives for `toHandle`, or until
 * `timeoutMs` elapses. While waiting, emits JSON heartbeat lines to the
 * provided stream every `heartbeatIntervalMs` (default 15s) so consumers
 * (e.g., Claude Code Bash tool) don't auto-background the subprocess.
 *
 * Returns the matched message (and marks it read), or null on timeout.
 */
import type { OrchestrationDb } from "./db";
import { claimNextUnread, type MessageRow, type MessageType } from "./messages";

export interface CheckWaitInput {
	toHandle: string;
	types: MessageType[];
	timeoutMs: number;
	heartbeatStream: NodeJS.WriteStream | null;
	heartbeatIntervalMs?: number;
	pollIntervalMs?: number;
}

export async function checkWait(db: OrchestrationDb, input: CheckWaitInput): Promise<MessageRow | null> {
	const deadline = Date.now() + input.timeoutMs;
	const heartbeatMs = input.heartbeatIntervalMs ?? 15_000;
	// Poll cadence must never exceed heartbeat cadence, else heartbeats can
	// be skipped when a long sleep covers the entire heartbeat window.
	const requestedPollMs = input.pollIntervalMs ?? 250;
	const pollMs = input.heartbeatStream
		? Math.min(requestedPollMs, Math.max(1, Math.floor(heartbeatMs / 2)))
		: requestedPollMs;

	let lastHeartbeat = Date.now();

	while (Date.now() < deadline) {
		// Atomic claim: two consumers polling the same `toHandle` are
		// guaranteed never to both receive the same message.
		const claimed = claimNextUnread(db, input.toHandle, {
			types: input.types,
			limit: 1,
		});
		if (claimed) return claimed;

		if (input.heartbeatStream && Date.now() - lastHeartbeat >= heartbeatMs) {
			const elapsed = Date.now() - (deadline - input.timeoutMs);
			input.heartbeatStream.write(JSON.stringify({
				_heartbeat: true,
				elapsedMs: elapsed,
				deadlineMs: deadline,
			}) + "\n");
			lastHeartbeat = Date.now();
		}

		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await new Promise(r => setTimeout(r, Math.min(pollMs, remaining)));
	}

	return null;
}
