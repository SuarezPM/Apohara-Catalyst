/**
 * Build the static bundle for Tauri release packaging.
 *
 * Bun's HTML-imports flow runs index.html through the dev server; for a Tauri
 * release binary we instead emit a self-contained `dist/` with main.js +
 * main.css + an index.html that references them by the bundled filenames.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distDir = resolve(root, "dist");

mkdirSync(distDir, { recursive: true });

const result = await Bun.build({
	entrypoints: [resolve(root, "src/main.tsx")],
	outdir: distDir,
	target: "browser",
	splitting: true,
	minify: true,
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

const css = result.outputs.find((o) => o.path.endsWith(".css"));
const js = result.outputs.find(
	(o) => o.path.endsWith(".js") && o.kind === "entry-point",
);

if (!js) {
	console.error("Build produced no entry-point JS file.");
	process.exit(1);
}

const cssHref = css ? `/${css.path.split("/").pop()}` : null;
const jsSrc = `/${js.path.split("/").pop()}`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Apohara — Visual Vibecoding Orchestrator</title>
    ${cssHref ? `<link rel="stylesheet" href="${cssHref}" />` : ""}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${jsSrc}"></script>
  </body>
</html>
`;

writeFileSync(resolve(distDir, "index.html"), html);

console.log(`Built ${result.outputs.length} files into ${distDir}`);
for (const o of result.outputs) {
	console.log(`  ${o.path.split("/").pop()}  ${(o.size / 1024).toFixed(2)} KB`);
}
