/**
 * OSC 998 command-state escape parser.
 *
 * G5.I.5 — nimbalyst inspiration. Coding agents that run inside our embedded
 * PTY (claude, codex, opencode) emit OSC 998 sequences to announce structured
 * command state on the SAME data stream as their visible output. The wire
 * format mirrors xterm's OSC convention:
 *
 *   ESC ']' '998' ';' <JSON payload> BEL
 *
 * `ESC` = 0x1B, `BEL` = 0x07. Some emitters terminate with the standard
 * ST = `ESC \\` (0x1B 0x5C) instead — we accept either.
 *
 * This module:
 *   - Maintains a buffered parser (`createOsc998Parser()`) so partial chunks
 *     across multiple `pty.onData` calls reassemble correctly.
 *   - Strips the escape sequence from the data so the visible terminal output
 *     stays clean.
 *   - Decodes the JSON payload safely (parse failures are tagged but never
 *     throw).
 *
 * Public surface intentionally minimal: one factory + one shape.
 */

export interface Osc998Event {
	/** Decoded JSON payload. `null` if the payload was not valid JSON. */
	payload: unknown;
	/** Raw JSON text between the delimiters. */
	raw: string;
}

export interface Osc998ParseResult {
	/** PTY chunk with all OSC 998 sequences removed. Safe to render. */
	clean: string;
	/** Every parsed event found in this chunk (oldest first). */
	events: Osc998Event[];
}

export interface Osc998Parser {
	/** Feed a chunk of PTY output; returns the cleaned chunk + events. */
	feed(chunk: string): Osc998ParseResult;
	/** Reset the internal buffer (e.g. on PTY restart). */
	reset(): void;
}

const ESC = "";
const BEL = "";
const ST_TERMINATOR = "\\";
const PREFIX = `${ESC}]998;`;

/**
 * Factory that creates a stateful parser keeping a small carry buffer for
 * sequences split across chunk boundaries.
 *
 * The buffer is capped at 64 KiB to prevent a malicious emitter from holding
 * unbounded data with an unterminated OSC.
 */
export function createOsc998Parser(): Osc998Parser {
	let carry = "";
	const MAX_CARRY = 64 * 1024;

	function feed(chunk: string): Osc998ParseResult {
		const events: Osc998Event[] = [];
		let buf = carry + chunk;
		let clean = "";
		carry = "";

		while (true) {
			const start = buf.indexOf(PREFIX);
			if (start === -1) {
				// No prefix at all — emit everything except a possible partial
				// prefix at the tail (so we don't accidentally split `\x1b]998;`
				// across chunks). Only hold back the suffix that COULD start a
				// prefix.
				let holdBack = 0;
				for (let k = Math.min(PREFIX.length - 1, buf.length); k > 0; k--) {
					if (buf.endsWith(PREFIX.slice(0, k))) {
						holdBack = k;
						break;
					}
				}
				if (holdBack > 0) {
					clean += buf.slice(0, buf.length - holdBack);
					carry = buf.slice(buf.length - holdBack);
				} else {
					clean += buf;
				}
				break;
			}

			// Emit everything before the prefix as clean output.
			clean += buf.slice(0, start);

			const payloadStart = start + PREFIX.length;
			const bel = buf.indexOf(BEL, payloadStart);
			const st = buf.indexOf(ST_TERMINATOR, payloadStart);

			// Find the nearest terminator (BEL or ST). -1 means "not yet".
			let termIdx = -1;
			let termLen = 0;
			if (bel !== -1 && (st === -1 || bel < st)) {
				termIdx = bel;
				termLen = 1;
			} else if (st !== -1) {
				termIdx = st;
				termLen = ST_TERMINATOR.length;
			}

			if (termIdx === -1) {
				// Unterminated — keep waiting unless we've blown the carry cap.
				const remainder = buf.slice(start);
				if (remainder.length > MAX_CARRY) {
					// Drop the runaway sequence to avoid OOM.
					carry = "";
				} else {
					carry = remainder;
				}
				return { clean, events };
			}

			const raw = buf.slice(payloadStart, termIdx);
			let payload: unknown = null;
			try {
				payload = JSON.parse(raw);
			} catch {
				payload = null;
			}
			events.push({ payload, raw });

			// Continue past this terminator and look for more.
			buf = buf.slice(termIdx + termLen);
		}

		return { clean, events };
	}

	function reset(): void {
		carry = "";
	}

	return { feed, reset };
}
