import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// G7.A.8 — E2E smoke for the published `apohara` npx wrapper. Gateado
// por APOHARA_TEST_PUBLISHED_VERSION para que solo corra en CI release
// context donde el paquete acaba de publicarse. Local dev no tiene un
// version published — saltarlo con warn en vez de fallar.
test("npx apohara --version returns version string", async () => {
  const ver = process.env.APOHARA_TEST_PUBLISHED_VERSION;
  if (!ver) {
    console.warn(
      "APOHARA_TEST_PUBLISHED_VERSION not set, skipping npx smoke",
    );
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "apohara-npx-smoke-"));
  try {
    const result = await new Promise<{ code: number; stdout: string }>(
      (resolve) => {
        const child = spawn("npx", [`apohara@${ver}`, "--version"], {
          cwd: dir,
          env: { ...process.env, PATH: process.env.PATH },
        });
        let stdout = "";
        child.stdout?.on("data", (c) => {
          stdout += c.toString();
        });
        child.on("exit", (code) => resolve({ code: code ?? 1, stdout }));
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(ver);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
