import { expect, test } from "bun:test";
import { redactSecrets } from "../../../src/core/logging/secretRedactor";

test("redacts AWS access key", () => {
	const input = "AKIAIOSFODNN7EXAMPLE is the key";
	expect(redactSecrets(input)).toBe("[REDACTED] is the key");
});

test("redacts ANTHROPIC_API_KEY env style", () => {
	const input = "ANTHROPIC_API_KEY=sk-ant-foo123bar456baz789qux012";
	const out = redactSecrets(input);
	expect(out).toContain("ANTHROPIC_API_KEY=[REDACTED]");
	expect(out).not.toContain("sk-ant-foo123bar456baz789qux012");
});

test("redacts Anthropic key in free text", () => {
	const input = "leaked sk-ant-foo123bar456baz789qux012 token";
	const out = redactSecrets(input);
	expect(out).toContain("[REDACTED]");
	expect(out).not.toContain("sk-ant-foo123bar456baz789qux012");
});

test("redacts GitHub token", () => {
	const input = "use ghp_abcdefghijklmnopqrstuvwxyz0123456789 to push";
	const out = redactSecrets(input);
	expect(out).toContain("[REDACTED]");
	expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
});

test("redacts Slack token", () => {
	const input = "slack xoxb-1234567890-abc-XYZ from webhook";
	const out = redactSecrets(input);
	expect(out).toContain("[REDACTED]");
});

test("redacts generic _TOKEN env style", () => {
	const input = "GITHUB_TOKEN=abc123xyz secret";
	expect(redactSecrets(input)).toContain("GITHUB_TOKEN=[REDACTED]");
});

test("redacts generic _SECRET env style", () => {
	const input = "WEBHOOK_SECRET=topsecret";
	expect(redactSecrets(input)).toContain("WEBHOOK_SECRET=[REDACTED]");
});

test("preserves text without secrets", () => {
	const input = "regular log line";
	expect(redactSecrets(input)).toBe(input);
});

test("handles empty string", () => {
	expect(redactSecrets("")).toBe("");
});

test("redacts multiple secrets in one line", () => {
	const input = "key1=AKIAIOSFODNN7EXAMPLE and key2=ghp_abcdefghijklmnopqrstuvwxyz0123456789";
	const out = redactSecrets(input);
	expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
	expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
});
