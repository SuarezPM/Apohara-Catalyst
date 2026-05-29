> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# WSL2 Smoke Test — Apohara Catalyst v1.0.0-rc.1

GitHub Actions does not provide native WSL2 runners, so this test runs manually before launch.

## Prerequisites on Windows host

- Windows 11 22H2+ with WSL2 enabled
- Ubuntu-22.04 distro installed: `wsl --install -d Ubuntu-22.04`
- Inside WSL2 distro: Bun 1.3.13+, Node 20+, Git

## Steps

```bash
# 1. Enter the WSL2 distro
wsl -d Ubuntu-22.04

# 2. Fetch the published tarball (or use the prerelease branch)
cd ~ && mkdir -p apohara-smoke && cd apohara-smoke
git clone https://github.com/SuarezPM/apohara
cd apohara
git checkout feat/apohara-catalyst  # or v1.0.0 tag once published

# 3. Build the npm tarball
cd npx-cli
bun install --frozen-lockfile
bun run build
npm pack
ls -la apohara-catalyst-*.tgz

# 4. Install globally
npm install -g ./apohara-catalyst-*.tgz

# 5. Verify the binary
apohara --version
# Expected: 1.0.0-rc.1 (or 1.0.0 at launch)

# 6. Run doctor — exit code 0 (all green) or 2 (warnings only) is acceptable
apohara doctor
echo "exit code: $?"

# 7. Optional: spin up the desktop server
# (only relevant if user wants UI; doctor result is the primary smoke gate)
apohara &
# Note WSL2 IP: `wsl --status` on Windows host
# Open http://<wsl-ip>:7331 from Windows browser

# 8. Cleanup
npm uninstall -g @apohara/catalyst
```

## Capture for the launch record

For each test session, append a row to the `## Resultados` table below:

| Date (UTC) | WSL distro | Tester | Result | Notes |
|---|---|---|---|---|

## Resultados

(Append entries here as tests execute. At least one PASS row required before Sprint 11 launch sign-off.)

| Date (UTC) | WSL distro | Tester | Result | Notes |
|---|---|---|---|---|
| _PENDING_ | Ubuntu-22.04 | Pablo | _TBD_ | First smoke before launch |
