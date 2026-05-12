import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		root: resolve(import.meta.dirname),
		include: ["./**/*.{test,spec}.{js,ts,jsx,tsx}"],
		exclude: ["node_modules", "dist"],
	},
});
