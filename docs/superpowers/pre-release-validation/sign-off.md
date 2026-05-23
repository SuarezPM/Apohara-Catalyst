# Apohara Catalyst v1.0.0 — Pre-Launch Sign-Off

## Reports

- [x] G10.A cross-platform: PROCEED (contingent CI matrix run + WSL2 manual smoke)
- [x] G10.B security: PROCEED
- [x] G10.C performance: PROCEED
- [x] G10.D doctor: PROCEED

## Outstanding (Pablo to verify before sign)

- [ ] CI cross-platform matrix run is green on the current HEAD (`gh run watch` or open Actions tab)
- [ ] WSL2 manual smoke test executed once per `docs/superpowers/pre-release-validation/wsl2-runbook.md` and resultados table updated
- [ ] macOS-14 manual install smoke (per `macos-notarization-runbook.md`) — optional unless distributing Tauri .app
- [ ] Locally verified: `npm install -g @apohara/catalyst-1.0.0-rc.1.tgz && apohara doctor`
- [ ] **Phase 1 Rust core cierre verified**: `cargo test --workspace` 836/0 + `cargo clippy --workspace -- -D warnings` clean + `./target/release/apohara doctor` exits 0 or 2 + Tauri desktop builds (15 Rust commands registered)

## Pablo sign-off

I, Pablo Suarez, approve the launch of `@apohara/catalyst@1.0.0`.

This authorizes the following destructive/public actions:

- [ ] Open PR `feat/apohara-catalyst` → `main` (NOT direct push)
- [ ] After PR merge: `git tag -s v1.0.0 -m "Apohara Catalyst v1.0.0 — public launch"`
- [ ] `git push origin v1.0.0`
- [ ] `cd npx-cli && npm publish --access public` (after `bun run build`)
- [ ] `gh release create v1.0.0 --notes-file RELEASE_NOTES.md --verify-tag`
- [ ] (Optional) Twitter/X / Mastodon / Bluesky / LinkedIn / Discord posts per `docs/superpowers/launch/social-copy.md`

Signed: ___________________________________ (Pablo writes initials here on launch day)
Date:   ___________________________________ (Pablo writes date YYYY-MM-DD)

## Post-launch verification

- [ ] `npm view @apohara/catalyst@1.0.0 dist.tarball` — verify package published
- [ ] `gh release view v1.0.0 --json url --jq .url` — verify release public
- [ ] Fresh-machine install via `docker run --rm node:20 npm install -g @apohara/catalyst`
- [ ] README badges updated (post-launch commit on main)
- [ ] Post-launch smoke report appended to `docs/superpowers/pre-release-validation/post-launch-smoke.md`

## Defer to v1.1+

- [ ] Real chief mascot artwork (current is placeholder PNG)
- [ ] Tauri .app/.dmg/.msi distribution + Apple notarization
- [ ] Demo video tooling
- [ ] Smart router / Reactions / Remote workers (feature flags)
- [ ] Reaction Engine state machine
- [ ] cmdk command palette real handlers (currently console.log placeholders)
- [ ] ViewToggle opt-in for KanbanBoard
- [ ] Migrate consumers off legacy v1 modules (agent-router, capability-manifest, etc.) — deferred from Sprint 7.5 G7.5.C
