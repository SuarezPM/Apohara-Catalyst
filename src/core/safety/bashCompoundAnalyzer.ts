/**
 * Bash compound command splitter per spec §4.6.
 *
 * Defensive parser-aware split that handles quoted strings, command and
 * process substitution, and pipes/job-background separators. The naive
 * `cmd.split(/&&|\|\||;/)` is unsafe because:
 *   git status && rm -rf /        ← caught by '&&'
 *   git status; rm -rf /          ← caught by ';'
 *   git status | rm -rf ~         ← MISSED by the old split (no '|')
 *   git status & rm -rf ~         ← MISSED (no single '&')
 *   git status $(rm -rf ~)        ← MISSED (no substitution extraction)
 *   git status `rm -rf ~`         ← MISSED (backticks only toggled)
 *   git status <(rm -rf ~)        ← MISSED (no <() handling)
 *   git status\nrm -rf ~          ← MISSED (no newline split)
 * Each of those would let a `Bash(git status:*)` allow leak the second
 * subcommand. The implementation below detects every separator outside
 * of quotes and recursively extracts substitution bodies as their own
 * subcommands.
 */

export function splitCompound(command: string): string[] {
	const result: string[] = [];
	let current = "";
	let i = 0;
	let inDouble = false;
	let inSingle = false;

	const pushCurrent = () => {
		const t = current.trim();
		if (t.length > 0) result.push(t);
		current = "";
	};

	while (i < command.length) {
		const c = command[i];
		const next = command[i + 1];

		// Backslash escapes — keep the next char as part of the token
		// (relevant only outside single quotes; bash doesn't honor `\` in
		// single-quoted strings).
		if (!inSingle && c === "\\" && i + 1 < command.length) {
			current += c + command[i + 1];
			i += 2;
			continue;
		}

		// String quote toggles. We only consider the quote-state for the
		// separator scan; the quote characters themselves remain in `current`
		// so callers see the original subcommand text.
		if (c === '"' && !inSingle) {
			inDouble = !inDouble;
			current += c;
			i += 1;
			continue;
		}
		if (c === "'" && !inDouble) {
			inSingle = !inSingle;
			current += c;
			i += 1;
			continue;
		}

		if (!inDouble && !inSingle) {
			// Command substitution $(...) — extract the inner body as its
			// own (recursively split) subcommand. A `Bash(git:*)` allow on
			// the outer must NOT cover the inner.
			if (c === "$" && next === "(") {
				pushCurrent();
				i += 2;
				let depth = 1;
				let inner = "";
				while (i < command.length && depth > 0) {
					const ic = command[i];
					if (ic === "\\" && i + 1 < command.length) {
						inner += ic + command[i + 1];
						i += 2;
						continue;
					}
					if (ic === "(") depth += 1;
					else if (ic === ")") {
						depth -= 1;
						if (depth === 0) {
							i += 1;
							break;
						}
					}
					inner += ic;
					i += 1;
				}
				for (const sub of splitCompound(inner)) result.push(sub);
				continue;
			}
			// Backtick command substitution `...` — same semantics.
			if (c === "`") {
				pushCurrent();
				i += 1;
				let inner = "";
				while (i < command.length && command[i] !== "`") {
					if (command[i] === "\\" && i + 1 < command.length) {
						inner += command[i] + command[i + 1];
						i += 2;
						continue;
					}
					inner += command[i];
					i += 1;
				}
				if (i < command.length) i += 1; // skip closing backtick
				for (const sub of splitCompound(inner)) result.push(sub);
				continue;
			}
			// Process substitution <(...) and >(...).
			if ((c === "<" || c === ">") && next === "(") {
				pushCurrent();
				i += 2;
				let depth = 1;
				let inner = "";
				while (i < command.length && depth > 0) {
					const ic = command[i];
					if (ic === "\\" && i + 1 < command.length) {
						inner += ic + command[i + 1];
						i += 2;
						continue;
					}
					if (ic === "(") depth += 1;
					else if (ic === ")") {
						depth -= 1;
						if (depth === 0) {
							i += 1;
							break;
						}
					}
					inner += ic;
					i += 1;
				}
				for (const sub of splitCompound(inner)) result.push(sub);
				continue;
			}
			// Boolean compound: && / ||
			if (c === "&" && next === "&") {
				pushCurrent();
				i += 2;
				continue;
			}
			if (c === "|" && next === "|") {
				pushCurrent();
				i += 2;
				continue;
			}
			// Statement terminator ;
			if (c === ";") {
				pushCurrent();
				i += 1;
				continue;
			}
			// Pipe |
			if (c === "|") {
				pushCurrent();
				i += 1;
				continue;
			}
			// Job-background / list separator &
			if (c === "&") {
				pushCurrent();
				i += 1;
				continue;
			}
			// Newline acts as a statement terminator in scripts.
			if (c === "\n") {
				pushCurrent();
				i += 1;
				continue;
			}
		}

		current += c;
		i += 1;
	}
	pushCurrent();
	return result;
}
