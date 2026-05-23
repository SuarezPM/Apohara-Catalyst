# apohara (npx shim)

The `apohara` npm package is a tiny shim that downloads the right
prebuilt binary for your platform and spawns it. No native build
chain, no Tauri toolchain — just `npx apohara` and the desktop UI
starts.

## Install + run

```bash
# One-off
npx apohara

# Or install globally
npm i -g apohara
apohara
```

## What happens

1. The shim detects your platform (`linux-x64`, `darwin-arm64`,
   `win32-x64`, …).
2. If you're inside a clone of the Apohara repo AND
   `target/release/apohara-desktop` exists, the LOCAL build wins
   (so contributors don't pull the release binary while iterating).
3. Otherwise the shim looks in `~/.apohara/bin/<version>/<platform>/`.
   Missing? It downloads the binary + `<asset>.sha256` from the
   matching GitHub release and verifies before caching.
4. Older versions in the cache are pruned AFTER the new one is in
   place + verified (atomic upgrade — no leaving you with a broken
   install if the download is corrupted).
5. The binary is spawned with your argv, stdio inherited, exit code
   forwarded.

## Build from source

```bash
git clone https://github.com/SuarezPM/apohara
cd apohara
cargo build --release      # builds target/release/apohara-desktop
npx apohara                # picks up the local build automatically
```

## Layout

```
npx-cli/
├── package.json     ← published as `apohara` on npm
└── src/
    ├── cli.ts       ← entry point (bin: `apohara`)
    ├── download.ts  ← GitHub release fetch + sha256 verify
    ├── cache.ts     ← ~/.apohara/bin/<v>/<platform>/ + pruning
    └── platform.ts  ← platform/arch detection
```

## Release expectations

For each tagged release `vX.Y.Z`, CI uploads to the GitHub release:

- `apohara-desktop-linux-x64`         + `.sha256`
- `apohara-desktop-linux-arm64`       + `.sha256`
- `apohara-desktop-darwin-x64`        + `.sha256`
- `apohara-desktop-darwin-arm64`      + `.sha256`
- `apohara-desktop-win32-x64.exe`     + `.sha256`
- `apohara-desktop-win32-arm64.exe`   + `.sha256`

The shim's `package.json` version MUST match the release tag (the
shim downloads `v<package.json:version>`).
