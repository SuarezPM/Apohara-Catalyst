import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOrCreateInstallId } from "../../../src/core/crash-reports/installId";

let originalHome: string | undefined;
let fakeHome: string;
beforeEach(async () => {
  originalHome = process.env.HOME;
  fakeHome = await mkdtemp(join(tmpdir(), "apohara-installid-"));
  process.env.HOME = fakeHome;
});
afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(fakeHome, { recursive: true, force: true });
});

test("first call creates UUID v4 + persists", async () => {
  const id = await getOrCreateInstallId();
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("subsequent calls return same UUID", async () => {
  const id1 = await getOrCreateInstallId();
  const id2 = await getOrCreateInstallId();
  expect(id1).toBe(id2);
});
