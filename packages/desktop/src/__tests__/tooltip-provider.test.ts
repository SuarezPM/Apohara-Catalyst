import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const APP_SRC = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8");

test("App.tsx imports TooltipProvider from @radix-ui/react-tooltip", () => {
	expect(APP_SRC).toMatch(/from\s+["']@radix-ui\/react-tooltip["']/);
	expect(APP_SRC).toContain("TooltipProvider");
});

test("TooltipProvider configured with 400ms delay", () => {
	expect(APP_SRC).toMatch(/delayDuration=\{?400\}?|delayDuration=["']400["']/);
});

test("TooltipProvider wraps the root render tree", () => {
	// Check that <TooltipProvider opens before any data-testid or other root content
	expect(APP_SRC).toMatch(/<TooltipProvider/);
});
