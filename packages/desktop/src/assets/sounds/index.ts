/**
 * Sound assets for desktop notifications (vibe-kanban #17 / G5.F.7).
 *
 * Three short WAV files cover the common notifier events:
 *
 *   - `task-done.wav`    — 880 Hz · 250 ms · short success tone
 *   - `task-failed.wav`  — 220 Hz · 350 ms · low buzz for errors
 *   - `attention.wav`    — 660 Hz · 180 ms · neutral "look at me"
 *
 * All assets are mono 16-bit PCM at 22050 Hz — small enough to bundle
 * directly in the desktop ship (~35 KiB total), large enough to be
 * audible through laptop speakers without a separate amp stage.
 *
 * The `SoundKind` enum is the public surface; the URL map exists so
 * tests can verify the bundling without requiring `<audio>` elements.
 */

export type SoundKind = "task-done" | "task-failed" | "attention";

/**
 * Map of sound kinds to their bundled asset path. The path is relative
 * to this module, so callers should resolve via `new URL(soundUrls[k],
 * import.meta.url)` in a browser context or via `path.join` in tests.
 */
export const soundUrls: Record<SoundKind, string> = {
	"task-done": "./task-done.wav",
	"task-failed": "./task-failed.wav",
	attention: "./attention.wav",
};

/**
 * Play a notification sound by kind. No-op when:
 *   - The `Audio` constructor is unavailable (SSR / unit tests).
 *   - The user has opted out via `localStorage.apohara_sound = "off"`.
 *
 * Best-effort: playback errors (autoplay policy, missing codec) are
 * swallowed so the notifier never throws on the UI render path.
 */
export function playSound(kind: SoundKind): void {
	if (typeof Audio === "undefined") return;
	if (
		typeof localStorage !== "undefined" &&
		localStorage.getItem("apohara_sound") === "off"
	) {
		return;
	}
	try {
		// Resolve via import.meta.url so the bundler keeps the asset.
		const url = new URL(soundUrls[kind], import.meta.url).toString();
		const audio = new Audio(url);
		audio.volume = 0.4;
		void audio.play().catch(() => {
			/* autoplay blocked / no output device — ignore */
		});
	} catch {
		/* swallow */
	}
}
