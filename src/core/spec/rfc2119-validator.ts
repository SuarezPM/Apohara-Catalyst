/**
 * RFC 2119 validation profiles per spec (symphony #1, G5.G.1).
 *
 * RFC 2119 (https://www.rfc-editor.org/rfc/rfc2119) reserves the
 * all-caps words MUST, MUST NOT, SHALL, SHALL NOT, REQUIRED, SHOULD,
 * SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL as requirement-strength
 * keywords. A spec that uses these words in lowercase or mixed case is
 * ambiguous: the reader cannot tell whether the writer meant RFC 2119
 * semantics or ordinary English prose. This validator flags such cases.
 *
 * Profiles
 * --------
 *   - "strict"  — every reserved word, in any non-ALL-CAPS form, is an
 *                 error. Default.
 *   - "lenient" — the "must" trio (MUST / SHALL / REQUIRED) remains an
 *                 error, but SHOULD / MAY / RECOMMENDED / OPTIONAL are
 *                 downgraded to warnings. Useful for legacy docs in
 *                 mid-conversion.
 *   - "off"     — no enforcement. The validator becomes a no-op. Kept so
 *                 callers can pass a profile from config without having
 *                 to branch on "should I even call validate".
 *
 * Markdown-aware
 * --------------
 * Reserved keywords inside ```fenced code``` blocks and inline `code`
 * spans are ignored — the rule targets prose, not embedded code.
 */

export type Rfc2119Profile = "strict" | "lenient" | "off";

export type Rfc2119Severity = "error" | "warning";

export interface Rfc2119Violation {
	/** 1-based line number where the violation occurred. */
	line: number;
	/** The reserved word as RFC 2119 spells it (e.g. "MUST", "SHOULD"). */
	keyword: string;
	/** The exact text the writer used (e.g. "must", "Should"). */
	matchedText: string;
	severity: Rfc2119Severity;
	/** Short fix hint (e.g. "use uppercase MUST or rephrase"). */
	suggestion: string;
}

export interface Rfc2119Result {
	profile: Rfc2119Profile;
	violations: Rfc2119Violation[];
}

// Order matters: the two-word forms are matched first so "must not" wins
// over the lone "must". Each entry holds the RFC 2119 canonical spelling
// and the case-insensitive regex used to find non-canonical occurrences.
const KEYWORDS = [
	{ keyword: "MUST NOT", pattern: /\bmust\s+not\b/gi },
	{ keyword: "SHALL NOT", pattern: /\bshall\s+not\b/gi },
	{ keyword: "SHOULD NOT", pattern: /\bshould\s+not\b/gi },
	{ keyword: "MUST", pattern: /\bmust\b/gi },
	{ keyword: "SHALL", pattern: /\bshall\b/gi },
	{ keyword: "REQUIRED", pattern: /\brequired\b/gi },
	{ keyword: "SHOULD", pattern: /\bshould\b/gi },
	{ keyword: "RECOMMENDED", pattern: /\brecommended\b/gi },
	{ keyword: "MAY", pattern: /\bmay\b/gi },
	{ keyword: "OPTIONAL", pattern: /\boptional\b/gi },
] as const;

// Lenient profile downgrades these to "warning"; the rest stay "error".
const LENIENT_WARN: ReadonlySet<string> = new Set([
	"SHOULD",
	"SHOULD NOT",
	"MAY",
	"RECOMMENDED",
	"OPTIONAL",
]);

/**
 * Mask markdown fenced and inline code by replacing them with same-length
 * runs of spaces. Same-length preserves line/column offsets so the
 * caller's line counter stays accurate.
 */
function maskCode(body: string): string {
	const lines = body.split(/\r?\n/);
	let inFence = false;
	const masked: string[] = [];
	for (const line of lines) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			masked.push(" ".repeat(line.length));
			continue;
		}
		if (inFence) {
			masked.push(" ".repeat(line.length));
			continue;
		}
		// Replace inline `…` spans with spaces of equal width.
		masked.push(line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length)));
	}
	return masked.join("\n");
}

function severityFor(profile: Rfc2119Profile, keyword: string): Rfc2119Severity {
	if (profile === "lenient" && LENIENT_WARN.has(keyword)) return "warning";
	return "error";
}

function suggestionFor(keyword: string): string {
	return `use uppercase ${keyword} or rephrase to avoid RFC 2119 keywords`;
}

/**
 * Validate the body of a markdown spec against RFC 2119 enforcement
 * levels. See module header for profile semantics. Default profile is
 * "strict" — matching the discipline §0 expects of new specs.
 */
export function validateRfc2119(
	body: string,
	profile: Rfc2119Profile = "strict",
): Rfc2119Result {
	if (profile === "off") {
		return { profile, violations: [] };
	}

	const masked = maskCode(body);
	const lines = masked.split(/\r?\n/);
	// Track already-reported character offsets per line so the two-word
	// match for "must not" suppresses the lone "must" at the same offset.
	const violations: Rfc2119Violation[] = [];
	const claimed = new Map<number, Set<number>>(); // line → set<col>

	for (const { keyword, pattern } of KEYWORDS) {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Reset regex state for each line so `lastIndex` is local.
			const re = new RegExp(pattern.source, pattern.flags);
			let m: RegExpExecArray | null;
			while ((m = re.exec(line)) !== null) {
				// Skip ALL-CAPS occurrences — those are correct usage.
				if (m[0] === keyword) continue;
				const col = m.index;
				const lineSet = claimed.get(i) ?? new Set<number>();
				// If a longer keyword already covered this column, skip.
				let overlaps = false;
				for (const c of lineSet) {
					if (col >= c && col < c + keyword.length + 1) {
						overlaps = true;
						break;
					}
				}
				if (overlaps) continue;
				lineSet.add(col);
				claimed.set(i, lineSet);
				violations.push({
					line: i + 1,
					keyword,
					matchedText: m[0],
					severity: severityFor(profile, keyword),
					suggestion: suggestionFor(keyword),
				});
			}
		}
	}

	// Sort by line then column for stable, reader-friendly output.
	violations.sort((a, b) => a.line - b.line);

	return { profile, violations };
}
