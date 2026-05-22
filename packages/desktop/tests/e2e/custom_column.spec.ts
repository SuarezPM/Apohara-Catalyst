import { test } from "@playwright/test";

test.fixme("custom column persists across reloads", async ({ page }) => {
  // TODO Stage 10: requires settings IO (read/write user settings) to
  // verify a user-defined column survives reload and round-trips through
  // the on-disk settings store.
  void page;
});
