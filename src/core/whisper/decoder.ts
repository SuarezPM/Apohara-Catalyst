import type { WhisperMessage } from "./encoder.ts";

const PREFIX = "\x1b[whisper:";
const SUFFIX = "\x1b\\";

export function decodeWhisper(line: string): WhisperMessage | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith(PREFIX) || !trimmed.endsWith(SUFFIX)) return null;
	const json = trimmed.slice(PREFIX.length, -SUFFIX.length);
	try {
		return JSON.parse(json) as WhisperMessage;
	} catch {
		return null;
	}
}
