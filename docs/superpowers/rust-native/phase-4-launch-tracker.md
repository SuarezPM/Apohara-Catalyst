# Apohara Catalyst Phase 4 Launch Tracker

## Cross-platform builds (S23)

| Target | Builder | Status |
|---|---|---|
| x86_64-unknown-linux-gnu | ubuntu-22.04 | release.yml authored |
| aarch64-unknown-linux-gnu | ubuntu-22.04 cross | release.yml authored |
| x86_64-apple-darwin | macos-14 | release.yml authored |
| aarch64-apple-darwin | macos-14 native | release.yml authored |
| x86_64-pc-windows-msvc | windows-2022 | release.yml authored |

## Distribution channels (S24)

| Channel | Command user | Artifact | Status |
|---|---|---|---|
| crates.io | cargo install apohara | crate publish | manifest ready, publish GATED |
| AUR | yay -S apohara-catalyst-bin | PKGBUILD | authored, push GATED |
| Homebrew | brew install apohara-catalyst | formula.rb | authored, push GATED |
| Scoop | scoop install apohara-catalyst | manifest.json | authored, push GATED |
| GitHub Releases | curl + chmod +x | tag v1.0.0 + binaries | release.yml ready, tag GATED |

## Sign-off (S25 — HARD HALT zone)

| Step | Status |
|---|---|
| Update sign-off.md with Phase 1-3 evidence | DONE |
| Pablo signature on sign-off.md | **GATED — Pablo** |
| cargo publish | **GATED — Pablo authorizes** |
| AUR push | **GATED — Pablo authorizes** |
| Homebrew tap | **GATED — Pablo authorizes** |
| Scoop manifest commit | **GATED — Pablo authorizes** |
| GitHub Release v1.0.0 | **GATED — Pablo authorizes** |
| Push branch + tag | **GATED — Pablo authorizes** |
