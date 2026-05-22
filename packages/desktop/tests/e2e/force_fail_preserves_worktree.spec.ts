import { test } from "@playwright/test";

test.fixme("force-fail preserves worktree", async ({ page }) => {
  // TODO Stage 10: requires apohara-worktree CLI + orchestration DB
  // to test force-fail end-to-end (worktree must be preserved on disk
  // after a forced failure so the user can inspect/recover work).
  void page;
});
