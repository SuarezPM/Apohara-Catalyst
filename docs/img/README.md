# Apohara visual assets

This directory hosts repository-rendered images: hero screenshots, diagrams,
and any other binary that the docs reference. Versioning binaries in git is
fine for assets under ~200 KB — anything larger goes through Git LFS (not yet
enabled; talk to a maintainer first).

## How to capture `hero.png`

The README references `docs/img/hero.png` — a dashboard shot of the desktop UI
with seeded demo tasks visible on the kanban. Recapture it whenever the UI
chrome materially changes (sidebar layout, status colors, footer copy).

Steps from a clean checkout:

```bash
# 1. Start the desktop dev server on the canonical port.
cd packages/desktop
APOHARA_DESKTOP_PORT=7331 bun --hot src/server.ts &
sleep 3

# 2. Open the browser at http://localhost:7331 (any modern browser).
#    Use a 1440×900 viewport (the rest of the README screenshots are sized
#    against that — anything bigger compresses badly on GitHub's renderer).

# 3. Click "+ Seed demo tasks" in the empty-state banner. You should see
#    five tasks land across the Backlog / In progress / Verification /
#    Done columns within a second.

# 4. Click one of the verified-and-done tasks to expand the
#    VerificationTimeline footer (judge + critic + invariants ticks).

# 5. Take a screenshot of the visible viewport (NOT a full-page capture —
#    those distort the kanban grid). Save as `docs/img/hero.png`.
```

Target image specs:

- Format: PNG (no JPEG — kanban gradients ghost).
- Size: 1440×900 px, ≤ 200 KB after pngquant/oxipng.
- Crop: include the top nav, the four columns, and the verification footer.
  Exclude the dock / OS chrome.
- Tooling: GNOME Screenshot, KDE Spectacle, macOS `Cmd+Shift+4`, or the
  Playwright MCP `browser_take_screenshot` action work equally well.

After capture, optimise:

```bash
pngquant --quality=70-90 --output docs/img/hero.png --force docs/img/hero.png
oxipng -o4 docs/img/hero.png
```

Commit the resulting binary on its own commit (`docs(img): hero.png capture`).
The README reference (`![Apohara dashboard](docs/img/hero.png)`) renders the
broken-image alt text gracefully until the binary lands, so you can ship the
README update before the screenshot is ready.
