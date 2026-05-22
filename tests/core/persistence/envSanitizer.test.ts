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
