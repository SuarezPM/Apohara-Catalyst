/**
 * Tests for the line-framed protocol sanitizer (symphony #8, G5.G.5).
 *
 * Provider CLIs emit line-framed output (NDJSON, plain text, etc.) on
 * stdout. A hostile or buggy stream can include:
 *   - ANSI escape sequences (terminal repaint, color codes)
 *   - non-printable control chars (NUL, BEL, ESC sequences)
 *   - oversized lines (megabyte JSON blobs that would OOM a JSON.parse)
 *
 * `sanitizeLineFramed` accepts the raw stdout chunk and a config and
 * returns clean, sized-capped lines ready to feed into a JSON parser.
 */

import { test, expect, describe } from "bun:test";
import {
	sanitizeLineFramed,
	stripControlChars,
	DEFAULT_MAX_LINE_BYTES,
	type LineFramedSanitizeResult,
} from "../../../src/core/protocols/line-framed";

describe("stripControlChars", () => {
	test("removes ANSI CSI color sequences", () => {
		const input = "\x1b[32mhello\x1b[0m world";
		expect(stripControlChars(input)).toBe("hello world");
	});

	test("removes ANSI OSC sequences (terminal title)", () => {
		const input = "\x1b]0;title\x07rest";
		expect(stripControlChars(input)).toBe("rest");
	});

	test("removes NUL bytes", () => {
		expect(stripControlChars("a\x00b")).toBe("ab");
	});

	test("removes BEL / BS / FF / VT", () => {
		expect(stripControlChars("a\x07b\x08c\x0cd\x0be")).toBe("abcde");
	});

	test("preserves common printable whitespace (TAB, CR, LF)", () => {
		expect(stripControlChars("a\tb\nc\rd")).toBe("a\tb\nc\rd");
	});

	test("preserves non-ASCII characters (utf-8)", () => {
		expect(stripControlChars("café — naïve")).toBe("café — naïve");
	});
});

describe("sanitizeLineFramed", () => {
	test("splits on \\n and \\r\\n", () => {
		const raw = "one\ntwo\r\nthree";
		const r = sanitizeLineFramed(raw);
		expect(r.lines).toEqual(["one", "two", "three"]);
	});

	test("drops empty lines", () => {
		const raw = "one\n\n\ntwo\n";
		const r = sanitizeLineFramed(raw);
		expect(r.lines).toEqual(["one", "two"]);
	});

	test("strips ANSI from each line before emitting", () => {
		const raw = '\x1b[1m{"a":1}\x1b[0m\n\x1b[31m{"b":2}\x1b[0m';
		const r = sanitizeLineFramed(raw);
		expect(r.lines).toEqual(['{"a":1}', '{"b":2}']);
	});

	test("drops oversized lines and reports them", () => {
		const giant = "x".repeat(DEFAULT_MAX_LINE_BYTES + 100);
		const raw = `keep\n${giant}\nalso-keep`;
		const r = sanitizeLineFramed(raw);
		expect(r.lines).toEqual(["keep", "also-keep"]);
		expect(r.droppedOversize).toBe(1);
	});

	test("custom maxLineBytes overrides default", () => {
		const raw = "small\n" + "x".repeat(20);
		const r = sanitizeLineFramed(raw, { maxLineBytes: 10 });
		expect(r.lines).toEqual(["small"]);
		expect(r.droppedOversize).toBe(1);
	});

	test("trim defaults to true", () => {
		const raw = "  spaced  \n\ttabbed\t";
		const r = sanitizeLineFramed(raw);
		expect(r.lines).toEqual(["spaced", "tabbed"]);
	});

	test("trim=false preserves leading/trailing whitespace per line", () => {
		const raw = "  spaced  ";
		const r = sanitizeLineFramed(raw, { trim: false });
		expect(r.lines).toEqual(["  spaced  "]);
	});

	test("counts dropped empty + dropped oversize separately", () => {
		// Layout: empty, empty, OVERSIZE, keep, empty (trailing \n).
		const raw = `\n\n${"x".repeat(DEFAULT_MAX_LINE_BYTES + 1)}\nkeep\n`;
		const r = sanitizeLineFramed(raw);
		expect(r.lines).toEqual(["keep"]);
		expect(r.droppedOversize).toBe(1);
		expect(r.droppedEmpty).toBe(3);
	});

	test("empty input returns empty lines", () => {
		const r = sanitizeLineFramed("");
		expect(r.lines).toEqual([]);
		expect(r.droppedOversize).toBe(0);
		expect(r.droppedEmpty).toBe(0);
	});

	test("result shape is stable", () => {
		const r: LineFramedSanitizeResult = sanitizeLineFramed("a\nb");
		expect(Object.keys(r).sort()).toEqual(["droppedEmpty", "droppedOversize", "lines"]);
	});

	test("measures bytes by UTF-8 length, not character count", () => {
		// One emoji = 4 UTF-8 bytes. With maxLineBytes=3, the emoji must
		// be dropped even though it's a single visual character.
		const r = sanitizeLineFramed("ok\n🚀", { maxLineBytes: 3 });
		expect(r.lines).toEqual(["ok"]);
		expect(r.droppedOversize).toBe(1);
	});
});
