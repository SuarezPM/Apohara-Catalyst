/**
 * culture #10 — Whisper protocol: structured messages over stderr
 * without polluting stdout. Wire format:
 *
 *   ESC '[' 'w' 'h' 'i' 's' 'p' 'e' 'r' ':' <json> ESC '\'
 *
 * Uses ANSI ST/OSC envelope so it falls through pipes/tty without
 * eating the rest of the line. Cheap to parse, easy to grep.
 */

export interface WhisperMessage {
	tag: string;
	level: "trace" | "debug" | "info" | "warn" | "error";
	msg: string;
	ts: number;
	[k: string]: unknown;
}

const PREFIX = "\x1b[whisper:";
const SUFFIX = "\x1b\\";

export function encodeWhisper(msg: WhisperMessage): string {
	return PREFIX + JSON.stringify(msg) + SUFFIX;
}
