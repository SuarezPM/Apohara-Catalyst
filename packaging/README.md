# Apohara Catalyst — Distribution Packaging (Phase 4 G4.B)

This directory holds the **drafts** for all 5 distribution channels.

Nothing in this directory triggers a publish or push. Each manifest is
authored locally, version-pinned to `1.0.0`, and waits for Pablo's
sign-off (see `docs/superpowers/pre-release-validation/sign-off.md`)
before being uploaded to the respective channel.

## Channels

| Channel | Path | Publish command (post-sign-off) |
|---|---|---|
| crates.io | (Cargo.toml metadata) | `cargo publish -p apohara` (then `-p apohara-tui`) |
| AUR | `aur/PKGBUILD` | `git push aur` to `aur/apohara-catalyst-bin.git` |
| Homebrew | `homebrew/apohara-catalyst.rb` | commit to `SuarezPM/homebrew-apohara` tap |
| Scoop | `scoop/apohara-catalyst.json` | commit to `SuarezPM/scoop-apohara` bucket |
| GitHub Releases | (release.yml workflow) | `git push origin v1.0.0` triggers `release.yml` matrix |

## sha256 placeholders

`PKGBUILD` + `apohara-catalyst.rb` + `apohara-catalyst.json` carry placeholder
`SKIP`/`REPLACE_*` checksums. They are filled at sign-off time from the
`.sha256` sidecars uploaded by `release.yml` per target.

## Verification before publish

```bash
# Verify all draft manifests parse correctly:
makepkg --printsrcinfo -f packaging/aur/PKGBUILD > /dev/null
ruby -c packaging/homebrew/apohara-catalyst.rb
jq . packaging/scoop/apohara-catalyst.json > /dev/null

# Verify release.yml lint:
actionlint .github/workflows/release.yml || true
```
