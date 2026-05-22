/**
 * Pattern validator per spec §4.6.
 *
 * LLM output sometimes bleeds code fragments into permission strings
 * (Bash(const:*), Bash(```:*), Bash(import:*)). Reject these at the
 * boundary so they never reach permissionCache or settings files.
 */

const GARBAGE = [
  /^Bash\(const:/,
  /^Bash\(\[\]:/,
  /^Bash\(\/\/:/,
  /^Bash\(```:/,
  /^Bash\(import:/,
  /^Bash\(function:/,
  /^Bash\(class:/,
  /^Bash\(export:/,
  /^Bash\(let:/,
  /^Bash\(var:/,
];

const SHAPE = /^(Bash|WebFetch|Edit|Write|Read|Glob|mcp__[a-z_-]+__[a-z_-]+)(\(.+\))?$/;

export function isValidPattern(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (GARBAGE.some(re => re.test(trimmed))) return false;
  return SHAPE.test(trimmed);
}