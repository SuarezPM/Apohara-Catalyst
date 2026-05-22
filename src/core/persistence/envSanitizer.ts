/**
 * Env sanitization per spec §0.4.
 *
 * EVERY `Bun.spawn` / `child_process.spawn` / `tauri-plugin-shell` call MUST
 * pass env through this sanitizer first. Blocklist covers API keys, tokens,
 * secrets, cloud creds — preventing accidental leakage to CLI subprocesses
 * which could (a) bill the wrong account (nimbalyst incident), (b) change
 * provider behavior, (c) leak credentials to logs.
 *
 * Pablo's hard rule: CLI wrappers ONLY, no API keys. This sanitizer enforces.
 */

export const DEFAULT_BLOCKLIST: RegExp[] = [
  // Generic credential patterns
  /^.*_API_KEY$/,
  /^.*_TOKEN$/,
  /^.*_SECRET$/,
  /^.*_PASSWORD$/,
  /^.*_PASSWD$/,

  // Provider-specific
  /^ANTHROPIC_/,
  /^OPENAI_/,
  /^GROQ_/,
  /^TOGETHER_/,
  /^MISTRAL_/,
  /^OPENROUTER_/,
  /^GEMINI_/,
  /^GOOGLE_API_KEY$/,
  /^COHERE_/,

  // Cloud credentials
  /^AWS_/,
  /^GOOGLE_APPLICATION_CREDENTIALS$/,
  /^GCP_/,
  /^GCLOUD_/,
  /^AZURE_/,

  // CI provider tokens
  /^CIRCLE_/,
  /^GITHUB_TOKEN$/,
  /^GH_TOKEN$/,
  /^GITLAB_/,
  /^BITBUCKET_/,
];

export interface SanitizeOptions {
  /** Additional patterns to block (combined with DEFAULT_BLOCKLIST) */
  extraBlocklist?: RegExp[];
  /** Allowlist that bypasses blocklist (use sparingly, e.g., `APOHARA_*` overrides) */
  allow?: string[];
}

export function sanitizeEnv(
  input: Record<string, string | undefined>,
  options: SanitizeOptions = {},
): Record<string, string> {
  const blocklist = [...DEFAULT_BLOCKLIST, ...(options.extraBlocklist ?? [])];
  const allow = new Set(options.allow ?? []);

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (allow.has(key)) {
      out[key] = value;
      continue;
    }
    if (blocklist.some(re => re.test(key))) {
      continue;
    }
    out[key] = value;
  }
  return out;
}
