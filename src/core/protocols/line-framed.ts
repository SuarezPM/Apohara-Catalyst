/**
 * Line-framed protocol sanitizer (symphony #8, G5.G.5).
 *
 * Provider CLIs emit line-framed output (NDJSON, plain text) on stdout.
 * Before that stream reaches `JSON.parse` or a UI renderer, three
 * classes of contamination must be stripped:
 *
 *   1. ANSI escape sequences (color codes, cursor moves, OSC titles).
 *      Some CLIs detect a TTY parent and emit color even with
 *      `--no-color`; once the bytes are on the wire we have to scrub.
 *
 *   2. Other control characters (NUL, BEL, BS, FF, VT, DEL). NUL bytes
 *      in particular can fool downstream consumers that treat them as
 *      string terminators.
 *
 *   3. Oversized lines. A megabyte-long JSON blob fed into `JSON.parse`
 *      can stall the event loop or OOM in extreme cases. We cap line
 *      length and drop anything larger; the count is reported so the
 *      caller can log it and the user can debug.
 *
 * The sanitizer is intentionally stateless and pure: it takes a chunk
 * of raw text, returns the sanitized lines plus drop counters. Stream
 * frame assembly (handling partial last lines) is the caller's job.
 *
 * Implementation note: this source file deliberately contains zero raw
 * control bytes. Every byte we test/strip is written as a `\\u` escape
 * inside a string passed to `new RegExp`, so the file diffs cleanly and
 * editors do not mangle it.
 */

/** Default upper bound for a single sanitized line (1 MiB). */
export const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

export interface LineFramedSanitizeOptions {
	/** Bytes (UTF-8 encoded) above which a line is dropped. */
	maxLineBytes?: number;
	/** When true (default), trim leading/trailing whitespace from each line. */
	trim?: boolean;
}

export interface LineFramedSanitizeResult {
	/** Clean, sized-capped, non-empty lines in original order. */
	lines: string[];
	/** Count of lines dropped because they exceeded `maxLineBytes`. */
	droppedOversize: number;
	/** Count of empty (post-strip, post-trim) lines that were skipped. */
	droppedEmpty: number;
}

// ANSI escape sequences. Three families, all begin with ESC (U+001B):
//   CSI:  ESC '[' params [letter]
//   OSC:  ESC ']' payload (BEL | ESC '\\')
//   misc one-byte intermediates: ESC followed by one of 7 8 = > ( )
const ANSI_RE = new RegExp(
	[
		"\\u001B\\[[0-?]*[ -/]*[@-~]",
		"\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)",
		"\\u001B[=>78()]",
	].join("|"),
	"g",
);

// C0 controls + DEL, EXCLUDING in-band whitespace bytes.
// Keep U+0009 (TAB), U+000A (LF), U+000D (CR). Drop the rest of
// U+0000..U+001F plus U+007F (DEL).
const CONTROL_RE = new RegExp(
	"[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]",
	"g",
);

/**
 * Strip ANSI escape sequences AND non-printable control characters
 * from `s`. Preserves TAB, LF, CR (the common in-band whitespace).
 */
export function stripControlChars(s: string): string {
	return s.replace(ANSI_RE, "").replace(CONTROL_RE, "");
}

const utf8Encoder = new TextEncoder();
function utf8ByteLength(s: string): number {
	return utf8Encoder.encode(s).byteLength;
}

/**
 * Tokenize `raw` into clean lines, dropping ANSI, control chars,
 * oversized lines, and (by default) empty lines.
 */
export function sanitizeLineFramed(
	raw: string,
	opts: LineFramedSanitizeOptions = {},
): LineFramedSanitizeResult {
	const maxBytes = opts.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
	const trim = opts.trim !== false;

	const lines: string[] = [];
	let droppedOversize = 0;
	let droppedEmpty = 0;

	if (raw.length === 0) {
		return { lines, droppedOversize, droppedEmpty };
	}

	for (const rawLine of raw.split(/\r?\n/)) {
		let line = stripControlChars(rawLine);
		if (trim) line = line.trim();
		if (line.length === 0) {
			droppedEmpty += 1;
			continue;
		}
		// Use UTF-8 byte length, not `.length`, so a 1-character emoji
		// (4 bytes in UTF-8) is correctly accounted for against a byte
		// budget. Otherwise a `maxLineBytes: 3` cap would let a single
		// emoji through and a downstream JSON parser would still face
		// the real wire size.
		if (utf8ByteLength(line) > maxBytes) {
			droppedOversize += 1;
			continue;
		}
		lines.push(line);
	}

	return { lines, droppedOversize, droppedEmpty };
}
