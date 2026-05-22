import { test } from "@playwright/test";

test.fixme("multi-select bulk archive flow", async ({ page }) => {
  // TODO Stage 10: requires full app boot (Tauri build infra) and a
  // populated orchestration DB to exercise area-selection + bulk archive
  // against real tasks across multiple status columns.
  void page;
});
