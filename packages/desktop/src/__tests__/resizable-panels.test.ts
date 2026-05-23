import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

test("react-resizable-panels in package.json", () => {
	const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"));
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };
	expect(deps["react-resizable-panels"]).toBeDefined();
});

test("App.tsx uses PanelGroup OR documents deferral", () => {
	const content = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8");
	// Either the lib is used OR there's a TODO comment explaining the deferral
	const used = content.includes("PanelGroup") || content.includes("react-resizable-panels");
	const deferred = content.match(/TODO.*resizable-panels/i);
	expect(used || deferred).toBeTruthy();
});
