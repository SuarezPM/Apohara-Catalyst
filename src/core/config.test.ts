import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Config Validation", () => {
	// Note: .env is loaded before tests run, so we test behavior
	// based on the actual .env values

	it("loads OPENCODE_API_KEY from .env", async () => {
		const module = await import(`./config?cacheBust=${Date.now()}`);
		// This test verifies that config loads successfully
		expect(module.config.OPENCODE_API_KEY).toBeTruthy();
	});

	it("allows optional DEEPSEEK_API_KEY", async () => {
		const module = await import(`./config?cacheBust2=${Date.now()}`);
		// DEEPSEEK_API_KEY is optional, so config should still load
		expect(module.config).toBeDefined();
		expect(module.config.OPENCODE_API_KEY).toBeTruthy();
	});
});
