import { test } from "@playwright/test";

test.fixme("smart-attention reorders tasks by tier", async ({ page }) => {
  // TODO Stage 10: requires running store fed by live hook events
  // (NeedsYou/Working/Done/Idle classifier) so smart-attention sort
  // can be validated against a realistic event stream.
  void page;
});
