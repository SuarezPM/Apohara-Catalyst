/**
 * Bash compound command splitter per spec §4.6.
 *
 * Defensive parser-aware split that handles quoted strings and command
 * substitution. The naive cmd.split(/&&|\|\||;/) is unsafe because
 * `git status && rm -rf /` would be approved by a `Bash(git status:*)` pattern.
 */

export function splitCompound(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let i = 0;
  let inDouble = false;
  let inSingle = false;
  let inBacktick = false;

  while (i < command.length) {
    const c = command[i];
    const next = command[i + 1];

    if (!inDouble && !inSingle && !inBacktick) {
      if (c === "&" && next === "&") { result.push(current.trim()); current = ""; i += 2; continue; }
      if (c === "|" && next === "|") { result.push(current.trim()); current = ""; i += 2; continue; }
      if (c === ";")                  { result.push(current.trim()); current = ""; i += 1; continue; }
    }

    if (c === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (c === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (c === "`" && !inSingle) inBacktick = !inBacktick;

    current += c;
    i += 1;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}