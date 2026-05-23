/**
 * Sound listener — plays bundled WAV cues on task lifecycle events
 * (G7.C.5, vibe-kanban #17).
 *
 * Subscribed channels:
 *   - `apohara://task-completed` (status === "done" → task-done.wav,
 *                                  status === "failed" → task-failed.wav)
 *   - `apohara://verifier-conflict` → attention.wav
 *   - `apohara://hook-event` (PreToolUse / permission-prompt) → attention.wav
 *
 * Playback is best-effort: `playSound` swallows autoplay-policy errors
 * and is a no-op when `Audio` is undefined (SSR / unit tests). The user
 * can mute via `localStorage.apohara_sound = "off"`.
 */
import { playSound } from "../../assets/sounds/index.js";
import type { ListenerDeps, RegistrationHandle } from "./index.js";

export function registerSoundListener(
	deps: ListenerDeps,
): RegistrationHandle {
	const onTaskCompleted = (payload: unknown) => {
		const p = payload as { status?: unknown };
		if (p?.status === "done") playSound("task-done");
		else if (p?.status === "failed") playSound("task-failed");
	};

	const onVerifierConflict = (_payload: unknown) => {
		// A judge/critic disagreement is the canonical "look at me" — the
		// user has to weigh in. The neutral attention cue is the right
		// register here (not a failure tone, since the run isn't over).
		playSound("attention");
	};

	const onHookEvent = (payload: unknown) => {
		const p = payload as { event?: unknown; type?: unknown };
		// Permission prompts are the most common reason a user needs to
		// look at the screen mid-run. Other hook events stay silent so
		// the dev loop isn't a constant beep-machine.
		const kind =
			typeof p?.event === "string"
				? p.event
				: typeof p?.type === "string"
					? p.type
					: "";
		if (kind === "PermissionRequest" || kind === "permission_prompt") {
			playSound("attention");
		}
	};

	deps.bus.on("apohara://task-completed", onTaskCompleted);
	deps.bus.on("apohara://verifier-conflict", onVerifierConflict);
	deps.bus.on("apohara://hook-event", onHookEvent);

	return {
		dispose() {
			deps.bus.off("apohara://task-completed", onTaskCompleted);
			deps.bus.off("apohara://verifier-conflict", onVerifierConflict);
			deps.bus.off("apohara://hook-event", onHookEvent);
		},
	};
}
