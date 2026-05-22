import { test, expect } from "bun:test";
import { sanitizeEnv, DEFAULT_BLOCKLIST } from "../../../src/core/persistence/envSanitizer";

test("sanitizeEnv strips ANTHROPIC_API_KEY", () => {
  const input = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-..." };
  const out = sanitizeEnv(input);
  expect(out.PATH).toBe("/usr/bin");
  expect(out.ANTHROPIC_API_KEY).toBeUndefined();
});

test("sanitizeEnv strips any *_API_KEY pattern", () => {
  const input = { FOO_API_KEY: "x", BAR_API_KEY: "y", HOME: "/h" };
  const out = sanitizeEnv(input);
  expect(out.HOME).toBe("/h");
  expect(out.FOO_API_KEY).toBeUndefined();
  expect(out.BAR_API_KEY).toBeUndefined();
});

test("sanitizeEnv strips *_TOKEN, *_SECRET, *_PASSWORD patterns", () => {
  const input = {
    GITHUB_TOKEN: "ghp_...",
    DB_PASSWORD: "p",
    JWT_SECRET: "s",
    APP_NAME: "ok"
  };
  const out = sanitizeEnv(input);
  expect(out.APP_NAME).toBe("ok");
  expect(out.GITHUB_TOKEN).toBeUndefined();
  expect(out.DB_PASSWORD).toBeUndefined();
  expect(out.JWT_SECRET).toBeUndefined();
});

test("sanitizeEnv strips provider-specific prefixes", () => {
  const input = {
    ANTHROPIC_FOO: "x",
    OPENAI_BAR: "y",
    GROQ_BAZ: "z",
    AWS_ACCESS_KEY_ID: "a",
    GOOGLE_APPLICATION_CREDENTIALS: "/path",
    INNOCENT: "ok"
  };
  const out = sanitizeEnv(input);
  expect(out.INNOCENT).toBe("ok");
  expect(out.ANTHROPIC_FOO).toBeUndefined();
  expect(out.OPENAI_BAR).toBeUndefined();
  expect(out.GROQ_BAZ).toBeUndefined();
  expect(out.AWS_ACCESS_KEY_ID).toBeUndefined();
  expect(out.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
});

test("sanitizeEnv passes through user-provided allowlist", () => {
  const input = { GITHUB_TOKEN: "leak", APOHARA_OVERRIDE: "ok" };
  const out = sanitizeEnv(input, { allow: ["APOHARA_OVERRIDE"] });
  expect(out.APOHARA_OVERRIDE).toBe("ok");
  expect(out.GITHUB_TOKEN).toBeUndefined();
});

test("DEFAULT_BLOCKLIST is exported and contains expected patterns", () => {
  const patterns = DEFAULT_BLOCKLIST.map(p => p.toString());
  expect(patterns).toContain("/^.*_API_KEY$/");
  expect(patterns).toContain("/^.*_TOKEN$/");
  expect(patterns).toContain("/^ANTHROPIC_/");
});

test("sanitizeEnv is case-insensitive", () => {
  const input = { anthropic_api_key: "leak", Anthropic_API_Key: "also leak", PATH: "/usr/bin" };
  const out = sanitizeEnv(input);
  expect(out.PATH).toBe("/usr/bin");
  expect(out.anthropic_api_key).toBeUndefined();
  expect(out.Anthropic_API_Key).toBeUndefined();
});

test("sanitizeEnv blocks generic *_KEY pattern (Stripe, Supabase, etc.)", () => {
  const input = {
    STRIPE_KEY: "sk_...",
    SUPABASE_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    PINECONE_API_KEY: "p",
    HOME: "/h"
  };
  const out = sanitizeEnv(input);
  expect(out.HOME).toBe("/h");
  expect(out.STRIPE_KEY).toBeUndefined();
  expect(out.SUPABASE_KEY).toBeUndefined();
  expect(out.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  expect(out.PINECONE_API_KEY).toBeUndefined();
});

test("sanitizeEnv blocks DB URLs with embedded credentials", () => {
  const input = {
    DATABASE_URL: "postgres://user:pass@host/db",
    MONGODB_URI: "mongodb://u:p@cluster.mongo.net",
    REDIS_URL: "redis://:secret@host:6379",
    OTHER_URL: "https://example.com"
  };
  const out = sanitizeEnv(input);
  expect(out.OTHER_URL).toBe("https://example.com");
  expect(out.DATABASE_URL).toBeUndefined();
  expect(out.MONGODB_URI).toBeUndefined();
  expect(out.REDIS_URL).toBeUndefined();
});

test("sanitizeEnv extraBlocklist combines with DEFAULT_BLOCKLIST", () => {
  const input = { CUSTOM_THING: "block", HOME: "/h" };
  const out = sanitizeEnv(input, { extraBlocklist: [/^CUSTOM_/] });
  expect(out.HOME).toBe("/h");
  expect(out.CUSTOM_THING).toBeUndefined();
});

test("sanitizeEnv allow wins over block (priority)", () => {
  // ANTHROPIC_API_KEY would normally be blocked, but allowlist wins
  const input = { ANTHROPIC_API_KEY: "intentional override", PATH: "/usr/bin" };
  const out = sanitizeEnv(input, { allow: ["ANTHROPIC_API_KEY"] });
  expect(out.ANTHROPIC_API_KEY).toBe("intentional override");
  expect(out.PATH).toBe("/usr/bin");
});
