/**
 * G5.F.7 — Sound assets + playback wrapper.
 *
 * The desktop notifier uses bundled WAV files to surface task-done,
 * task-failed, attention events. We verify the files ship in the
 * expected location and that the `playSound` wrapper degrades safely
 * in environments without the Audio constructor.
 */
import { describe, expect, test } from "bun:test";
import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	playSound,
	soundUrls,
	type SoundKind,
} from "../../packages/desktop/src/assets/sounds";

const SOUND_DIR = resolve(
	import.meta.dir,
	"../../packages/desktop/src/assets/sounds",
);

describe("G5.F.7 — sound assets", () => {
	const kinds: SoundKind[] = ["task-done", "task-failed", "attention"];

	test("each kind has a matching .wav file on disk", async () => {
		for (const k of kinds) {
			const path = resolve(SOUND_DIR, `${k}.wav`);
			const s = await stat(path);
			expect(s.size).toBeGreaterThan(1000); // sanity floor
			expect(s.size).toBeLessThan(64 * 1024); // bundle-friendly ceiling
		}
	});

	test("each WAV file has the RIFF/WAVE magic header", async () => {
		for (const k of kinds) {
			const buf = await readFile(resolve(SOUND_DIR, `${k}.wav`));
			expect(buf.slice(0, 4).toString("ascii")).toBe("RIFF");
			expect(buf.slice(8, 12).toString("ascii")).toBe("WAVE");
		}
	});

	test("soundUrls map covers all kinds", () => {
		for (const k of kinds) {
			expect(soundUrls[k]).toBeTruthy();
			expect(soundUrls[k].endsWith(".wav")).toBe(true);
		}
	});

	test("playSound is a no-op when Audio is undefined", () => {
		// Bun's test environment has no `Audio` constructor; playSound
		// must NOT throw and MUST NOT log to stderr.
		expect(() => playSound("task-done")).not.toThrow();
	});
});
