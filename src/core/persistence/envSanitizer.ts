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
  /^.*_KEY$/,
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
  /^XAI_/,
  /^DEEPSEEK_/,
  /^PERPLEXITY_/,
  /^FIREWORKS_/,
  /^PINECONE_/,
  /^VOYAGE_/,
  /^REPLICATE_/,
  /^HUGGINGFACE_/,
  /^HF_TOKEN$/,

  // Cloud credentials
  /^AWS_/,
  /^GOOGLE_APPLICATION_CREDENTIALS$/,
  /^GCP_/,
  /^GCLOUD_/,
  /^AZURE_/,
  /^CLOUDFLARE_/,
  /^DIGITALOCEAN_/,

  // PaaS / hosting tokens
  /^VERCEL_/,
  /^NETLIFY_/,
  /^HEROKU_/,
  /^FLY_API_TOKEN$/,
  /^RAILWAY_TOKEN$/,
  /^RENDER_/,

  // DB URLs that embed credentials (user:pass@host)
  /^DATABASE_URL$/,
  /^MONGODB_URI$/,
  /^MYSQL_URL$/,
  /^POSTGRES_URL$/,
  /^REDIS_URL$/,

  // Backend / SaaS provider prefixes
  /^SUPABASE_/,
  /^STRIPE_/,
  /^SENTRY_/,
  /^NPM_TOKEN$/,

  // CI provider tokens
  /^CIRCLE_/,
  /^GITHUB_TOKEN$/,
  /^GH_TOKEN$/,
  /^GITLAB_/,
  /^BITBUCKET_/,

  // Webhook / integration tokens
  /^LINEAR_API_KEY$/,
  /^NOTION_TOKEN$/,
  /^SLACK_TOKEN$/,
  /^SLACK_BOT_TOKEN$/,
  /^DISCORD_TOKEN$/,
  /^TELEGRAM_TOKEN$/,
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
    // Compare on upper-cased key so blocklist patterns (uppercase-anchored)
    // also catch lowercase / mixed-case variants like `anthropic_api_key`.
    const keyUpper = key.toUpperCase();
    if (blocklist.some(re => re.test(keyUpper))) {
      continue;
    }
    out[key] = value;
  }
  return out;
}
