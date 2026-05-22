import { test } from "@playwright/test";

test.fixme("durable permission dialog survives remount", async ({ page }) => {
  // TODO Stage 10: requires the ledger backend so a pending permission
  // request persists across UI unmount/remount cycles per §4.6 +
  // nimbalyst #3.1 (durable across reloads, not just component lifetime).
  void page;
});
