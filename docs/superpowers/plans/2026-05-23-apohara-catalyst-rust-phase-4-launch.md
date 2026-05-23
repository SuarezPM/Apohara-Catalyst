# Apohara Catalyst Rust-Native Phase 4 — Distribution + Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **OPERATIONAL plan (no TDD)**: Phase 4 es packaging + distribution + launch operations. No new code logic — solo build pipelines, package manifests, distribution metadata, sign-off, y release commands. Cada task tiene comandos exactos + verificación manual + HALT GATES explícitos antes de actions irreversibles.

**Goal:** Empaquetar `apohara` Rust binary para 5 platforms (x86_64-linux, aarch64-linux, x86_64-macos, aarch64-macos, x86_64-windows-msvc). Publicar en 5 channels (crates.io, AUR, Homebrew, Scoop, GitHub Releases). Obtener firma Pablo en sign-off doc. Push branch + tag v1.0.0 + launch público en TODOS los channels simultáneamente.

**Architecture:** 3 sprints. S23 build matrix GitHub Actions. S24 distribution packaging (PKGBUILDs + formulas + manifests). S25 sign-off + launch. Branch destino: `feat/apohara-catalyst` (continúa desde Phase 3 cierre, post rc.4 milestone).

**HARD RULES** (de CLAUDE.md global + workflow):
- NUNCA `git push` sin autorización Pablo (incluye PR creation, force push, tag push).
- NUNCA `cargo publish` sin sign-off firmado.
- NUNCA distribuir paquetes (AUR push, Homebrew tap, Scoop manifest commit) sin sign-off firmado.
- HALT GATE explícito antes de cualquier acción irreversible. Si HALT → mensaje a Pablo + esperar.

---

## Estructura Phase 4

### 3 grupos / 3 sprints

| Grupo | Sprint | Scope | Esfuerzo | Implementers |
|---|---|---|---:|---|
| **G4.A** | S23 | Cross-platform build pipeline (GitHub Actions matrix) | 4d | 1 |
| **G4.B** | S24 | Distribution packaging (5 channels) | 3d | 1-2 paralelos |
| **G4.C** | S25 | Sign-off + launch operacional | 3d | 1 (gated por Pablo) |

**Total**: ~10 días + Pablo signature wait time (variable).

---

## Setup (antes de G4.A)

- [ ] **Setup 1: Verificar Phase 3 cierre verde**

```bash
git status
git log --oneline -3
# Esperado: último commit "chore(sprint): S22 Z3 INV-bash-scope + verification-mesh — Phase 3 COMPLETE"
cargo test --workspace 2>&1 | tail -5
# Esperado: all green.
cargo build --release --workspace 2>&1 | tail -5
# Esperado: builds clean.
```

- [ ] **Setup 2: Tracking doc para Phase 4**

Create `docs/superpowers/rust-native/phase-4-launch-tracker.md`:

```markdown
# Apohara Catalyst Phase 4 Launch Tracker

## Cross-platform builds (S23)

| Target | Builder | Status |
|---|---|---|
| x86_64-unknown-linux-gnu | ubuntu-22.04 | TODO |
| aarch64-unknown-linux-gnu | ubuntu-22.04 cross | TODO |
| x86_64-apple-darwin | macos-14 | TODO |
| aarch64-apple-darwin | macos-14 native | TODO |
| x86_64-pc-windows-msvc | windows-2022 | TODO |

## Distribution channels (S24)

| Channel | Command user | Artifact | Status |
|---|---|---|---|
| crates.io | cargo install apohara | crate publish | TODO |
| AUR | yay -S apohara-catalyst-bin | PKGBUILD | TODO |
| Homebrew | brew install apohara-catalyst | formula.rb | TODO |
| Scoop | scoop install apohara-catalyst | manifest.json | TODO |
| GitHub Releases | curl + chmod +x | tag v1.0.0 + binaries | TODO |

## Sign-off (S25)

| Step | Status |
|---|---|
| Update sign-off.md con Phase 1-3 evidence | TODO |
| Pablo signature en sign-off.md | **GATED — Pablo** |
| cargo publish | GATED |
| AUR push | GATED |
| Homebrew tap | GATED |
| Scoop manifest commit | GATED |
| GitHub Release v1.0.0 | GATED |
| Push branch + tag | GATED |
```

```bash
git add docs/superpowers/rust-native/phase-4-launch-tracker.md
git commit -m "docs: Phase 4 launch tracker (5 builds × 5 channels)"
```

---

## G4.A — Sprint 23 Cross-platform builds (4d, 1 implementer)

**Outcome esperado**: GitHub Actions workflow `release.yml` matrix builds binarios reproducibles para 5 targets. Artifacts uploaded + accesible para Sprint 24 distribution packaging.

### Task G4.A.1: Crear release.yml GitHub Actions workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Escribir workflow**

```yaml
# .github/workflows/release.yml
name: release-build

on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      version:
        description: "Version (sin prefijo v, ej: 1.0.0-rc.4)"
        required: true

permissions:
  contents: write

jobs:
  build:
    name: build-${{ matrix.target }}
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - target: x86_64-unknown-linux-gnu
            runner: ubuntu-22.04
            cross: false
          - target: aarch64-unknown-linux-gnu
            runner: ubuntu-22.04
            cross: true
          - target: x86_64-apple-darwin
            runner: macos-14
            cross: false
          - target: aarch64-apple-darwin
            runner: macos-14
            cross: false
          - target: x86_64-pc-windows-msvc
            runner: windows-2022
            cross: false

    steps:
      - uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install cross (Linux aarch64)
        if: matrix.cross == true
        run: cargo install cross --version 0.2.5

      - name: Install platform deps (Linux)
        if: contains(matrix.runner, 'ubuntu')
        run: |
          sudo apt-get update
          sudo apt-get install -y libz3-dev pkg-config libssl-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev

      - name: Install platform deps (macOS)
        if: contains(matrix.runner, 'macos')
        run: brew install z3

      - name: Build apohara binary (native)
        if: matrix.cross == false
        run: cargo build --release --target ${{ matrix.target }} -p apohara

      - name: Build apohara binary (cross)
        if: matrix.cross == true
        run: cross build --release --target ${{ matrix.target }} -p apohara

      - name: Build apohara-desktop-dioxus (native non-cross)
        if: matrix.cross == false
        run: cargo build --release --target ${{ matrix.target }} -p apohara-desktop-dioxus

      - name: Build apohara-tui
        if: matrix.cross == false
        run: cargo build --release --target ${{ matrix.target }} -p apohara-tui

      - name: Stage binaries
        shell: bash
        run: |
          mkdir -p dist
          ext=""
          if [[ "${{ matrix.target }}" == *windows* ]]; then ext=".exe"; fi
          cp target/${{ matrix.target }}/release/apohara${ext} dist/apohara-${{ matrix.target }}${ext}
          if [[ "${{ matrix.cross }}" != "true" ]]; then
            cp target/${{ matrix.target }}/release/apohara-desktop-dioxus${ext} dist/apohara-desktop-${{ matrix.target }}${ext}
            cp target/${{ matrix.target }}/release/apohara-tui${ext} dist/apohara-tui-${{ matrix.target }}${ext}
          fi

      - name: Compute SHA256 sums
        shell: bash
        run: |
          cd dist
          if command -v sha256sum >/dev/null; then
            sha256sum apohara-* > SHA256SUMS-${{ matrix.target }}
          else
            shasum -a 256 apohara-* > SHA256SUMS-${{ matrix.target }}
          fi
          cat SHA256SUMS-${{ matrix.target }}

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: apohara-${{ matrix.target }}
          path: dist/
          retention-days: 14
```

- [ ] **Step 2: Verify YAML syntactically valid**

Run: `cat .github/workflows/release.yml | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin); print('OK')"`
Expected: prints "OK".

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): cross-platform build matrix workflow (G4.A.1)

5 targets: x86_64/aarch64 linux + x86_64/aarch64 macos + x86_64 windows-msvc.
Builds apohara (CLI), apohara-desktop-dioxus (UI), apohara-tui en cada
non-cross target. cross-rs for aarch64-linux. Artifacts retention 14d.
SHA256SUMS computed per target."
```

### Task G4.A.2: Trigger workflow + verify artifacts en CI

**Action requires Pablo authorization** since it would push a tag to remote OR run workflow_dispatch (visible en GitHub UI to the org).

- [ ] **Step 1: HALT GATE — Pablo authorization required**

> **HALT**: Trigger del workflow requiere o push (no autorizado) o workflow_dispatch (visible). El implementer DEBE pausar aquí + mensaje a Pablo:
>
> "Workflow release.yml está listo. Para validarlo necesito autorización para uno de:
> 1. Push tag temporal `v0.0.0-build-test` para trigger automático
> 2. Ejecutar workflow_dispatch desde GitHub UI con version `1.0.0-rc.4-build-test`
>
> Cuál preferís? Si ninguno, podemos diferir validation a Sprint 25 cuando arranca real release."

- [ ] **Step 2: SI Pablo aprueba opción 1 (tag temp)**

```bash
git tag v0.0.0-build-test
git push origin v0.0.0-build-test  # REQUIERE AUTORIZACIÓN EXPLÍCITA
# Esperar workflow completion (~30 min en matrix x5)
gh run watch
# Verificar artifacts:
gh run download --name apohara-x86_64-unknown-linux-gnu --dir /tmp/artifacts-test
ls /tmp/artifacts-test
# Cleanup tag temporal:
git tag -d v0.0.0-build-test
git push origin :refs/tags/v0.0.0-build-test  # REQUIERE AUTORIZACIÓN
```

- [ ] **Step 3: SI Pablo aprueba opción 2 (workflow_dispatch)**

```bash
gh workflow run release.yml -f version=1.0.0-rc.4-build-test
gh run watch
gh run download --name apohara-x86_64-unknown-linux-gnu --dir /tmp/artifacts-test
ls /tmp/artifacts-test
```

- [ ] **Step 4: Verificar SHA256 + binarios bootean**

```bash
# Linux x86_64 binary
chmod +x /tmp/artifacts-test/apohara-x86_64-unknown-linux-gnu
/tmp/artifacts-test/apohara-x86_64-unknown-linux-gnu --version
/tmp/artifacts-test/apohara-x86_64-unknown-linux-gnu doctor
cat /tmp/artifacts-test/SHA256SUMS-x86_64-unknown-linux-gnu
```

Expected: `--version` prints; `doctor` exits 0 or 2.

- [ ] **Step 5: Commit verificación + observed SHA256**

Update tracker:

```bash
# Editar docs/superpowers/rust-native/phase-4-launch-tracker.md
# Marcar TODO → "verified [DATE] (SHA256: $SHA)" en cada row de Cross-platform builds.

git add docs/superpowers/rust-native/phase-4-launch-tracker.md
git commit -m "ci(release): workflow validated en 5 targets — artifacts smoke-tested (G4.A.2)

5 targets producen binarios funcionales:
- x86_64-unknown-linux-gnu: SHA256 [VALUE]
- aarch64-unknown-linux-gnu: SHA256 [VALUE]
- x86_64-apple-darwin: SHA256 [VALUE]
- aarch64-apple-darwin: SHA256 [VALUE]
- x86_64-pc-windows-msvc: SHA256 [VALUE]

Apohara CLI --version + doctor work en x86_64-linux smoke."
```

### Task G4.A.3: Apple signing / Windows code signing (OPCIONAL)

**Files:**
- Modify: `.github/workflows/release.yml` (add signing steps gated by secrets)

- [ ] **Step 1: HALT GATE — verificar credenciales disponibles**

> **HALT**: Apple notarization requiere Apple Developer account + certificate. Windows code signing requiere cert. Estos son opcionales per spec §5.
>
> Si Pablo NO tiene credentials → skip esta task. Ship sin signing + instrucciones en README de cómo el usuario verifica SHA256.
>
> Si Pablo SÍ tiene → seguir below.

- [ ] **Step 2: Add signing secrets steps (si Pablo tiene certs)**

Add a `release.yml`:

```yaml
      - name: Sign macOS binary (notarize)
        if: contains(matrix.runner, 'macos') && env.APPLE_DEVELOPER_CERT != ''
        env:
          APPLE_DEVELOPER_CERT: ${{ secrets.APPLE_DEVELOPER_CERT_BASE64 }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          # Decodificar cert
          echo "$APPLE_DEVELOPER_CERT" | base64 -d > /tmp/cert.p12
          # codesign + notarize
          codesign --force --sign "Developer ID Application: $APPLE_TEAM_ID" dist/apohara-${{ matrix.target }}
          # notarytool flow
          xcrun notarytool submit dist/apohara-${{ matrix.target }} --keychain-profile ApohaActor --wait

      - name: Sign Windows binary
        if: contains(matrix.runner, 'windows') && env.WIN_CERT_PFX != ''
        env:
          WIN_CERT_PFX: ${{ secrets.WIN_CERT_PFX_BASE64 }}
          WIN_CERT_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
        run: |
          $bytes = [System.Convert]::FromBase64String($env:WIN_CERT_PFX)
          [System.IO.File]::WriteAllBytes("C:\cert.pfx", $bytes)
          signtool sign /f C:\cert.pfx /p $env:WIN_CERT_PASSWORD /fd SHA256 /t http://timestamp.digicert.com dist\apohara-${{ matrix.target }}.exe
        shell: pwsh
```

- [ ] **Step 3: Si signing skipped, document en RELEASE_NOTES**

Append a `RELEASE_NOTES.md`:

```markdown
## Verifying binaries (unsigned platforms)

apohara v1.0.0 ships unsigned on [LIST OF PLATFORMS]. Verify via SHA256:

```bash
# Linux/macOS
shasum -a 256 apohara
# Compare contra SHA256SUMS file en GitHub Release page
```

```powershell
# Windows
Get-FileHash apohara.exe -Algorithm SHA256
```

Signing TODO: tracked en issue [LINK] for v1.1.
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml RELEASE_NOTES.md
git commit -m "ci(release): optional Apple/Windows code signing + SHA256 verification fallback (G4.A.3)

Signing gated por secrets — if absent, ship sin signing + RELEASE_NOTES
documenta SHA256 manual verification path. Tracked v1.1 issue."
```

### Task G4.A.4: Sprint 23 cierre

- [ ] **Step 1: Verify all tests + workspace**

Run: `cargo test --workspace 2>&1 | tail -5`
Expected: green.

- [ ] **Step 2: Sprint 23 cierre commit**

```bash
git commit --allow-empty -m "chore(sprint): S23 cross-platform build matrix COMPLETE

5 targets validated (or skipped if Pablo aún no autorizó trigger).
Artifacts contain apohara + apohara-desktop-dioxus + apohara-tui per
non-cross target. SHA256SUMS computed. Optional Apple/Windows signing
scaffolded behind secrets gates.

Sprint 24 (distribution packaging) arranca."
```

---

## G4.B — Sprint 24 Distribution packaging (3d, 1-2 paralelos)

**Outcome esperado**: 5 distribution channels listos para activar al sign-off:
1. crates.io: `cargo publish` ready (package metadata complete)
2. AUR: PKGBUILD validado
3. Homebrew: formula ready (`apohara/homebrew-tap` repo)
4. Scoop: manifest.json ready
5. GitHub Releases: triggered via tag push

**Paralelización scheme** (paths disjuntos):
- **Implementer 1**: crates.io + GitHub Releases workflow tweaks → `crates/apohara/Cargo.toml` + `.github/workflows/release.yml`
- **Implementer 2**: AUR PKGBUILD + Homebrew formula + Scoop manifest → `dist/{aur,homebrew,scoop}/`

### Task G4.B.1: Implementer 1 — crates.io package metadata

**Files:**
- Modify: `crates/apohara/Cargo.toml`
- Modify: `Cargo.toml` (workspace inheritable metadata)

- [ ] **Step 1: Workspace metadata**

Edit `Cargo.toml` raíz, ensure workspace.package is complete:

```toml
[workspace.package]
version = "1.0.0"
edition = "2021"
authors = ["Pablo Suarez <dimensionequix@gmail.com>"]
license = "MIT OR Apache-2.0"
repository = "https://github.com/SuarezPM/apohara-catalyst"
homepage = "https://github.com/SuarezPM/apohara-catalyst"
description = "Local-first multi-AI orchestrator with formal safety invariants."
readme = "README.md"
keywords = ["ai", "orchestrator", "local-first", "rust", "tauri"]
categories = ["command-line-utilities", "development-tools"]
rust-version = "1.80"
```

- [ ] **Step 2: apohara crate metadata**

Edit `crates/apohara/Cargo.toml`:

```toml
[package]
name = "apohara"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
description = "Apohara Catalyst CLI — local-first multi-AI orchestrator."
readme = "README.md"
keywords.workspace = true
categories.workspace = true
rust-version.workspace = true
include = ["src/**/*", "Cargo.toml", "README.md", "../../LICENSE-*"]
```

- [ ] **Step 3: README.md root con install instructions**

Verify root `README.md` exists con sección "Installation" mentioning cargo install:

```markdown
## Installation

```bash
cargo install apohara
```

Or download the prebuilt binary from [GitHub Releases](https://github.com/SuarezPM/apohara-catalyst/releases).
```

- [ ] **Step 4: Dry-run cargo publish**

```bash
cd crates/apohara
cargo publish --dry-run --allow-dirty 2>&1 | tail -20
```

Expected: "Packaging" + "Verifying" + "Uploading" steps mock-succeed. Errors here block sign-off.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/apohara/Cargo.toml README.md
git commit -m "chore(crates.io): package metadata complete for cargo publish (G4.B.1)

Workspace + apohara crate inherit version 1.0.0, license MIT/Apache-2.0,
repo https://github.com/SuarezPM/apohara-catalyst.

cargo publish --dry-run passes. Real publish gated por sign-off (G4.C.2)."
```

### Task G4.B.2: Implementer 2 — AUR PKGBUILD

**Files:**
- Create: `dist/aur/apohara-catalyst-bin/PKGBUILD`
- Create: `dist/aur/apohara-catalyst-bin/.SRCINFO`

- [ ] **Step 1: Crear PKGBUILD**

```bash
mkdir -p dist/aur/apohara-catalyst-bin
```

```bash
# dist/aur/apohara-catalyst-bin/PKGBUILD
# Maintainer: Pablo Suarez <dimensionequix@gmail.com>
pkgname=apohara-catalyst-bin
pkgver=1.0.0
pkgrel=1
pkgdesc="Local-first multi-AI orchestrator with formal safety invariants (binary release)"
arch=('x86_64' 'aarch64')
url="https://github.com/SuarezPM/apohara-catalyst"
license=('MIT' 'Apache')
depends=('glibc' 'gcc-libs')
provides=('apohara')
conflicts=('apohara')
source_x86_64=("apohara-${pkgver}-x86_64::${url}/releases/download/v${pkgver}/apohara-x86_64-unknown-linux-gnu")
source_aarch64=("apohara-${pkgver}-aarch64::${url}/releases/download/v${pkgver}/apohara-aarch64-unknown-linux-gnu")
sha256sums_x86_64=('SKIP')  # placeholder — replace al release time con sum real
sha256sums_aarch64=('SKIP') # placeholder

package() {
    install -Dm755 "${srcdir}/apohara-${pkgver}-${CARCH}" "${pkgdir}/usr/bin/apohara"
}
```

- [ ] **Step 2: Generar .SRCINFO**

```bash
cd dist/aur/apohara-catalyst-bin
# Requires `makepkg` — instalado en CachyOS por defecto.
makepkg --printsrcinfo > .SRCINFO
cat .SRCINFO
```

Expected: archivo `.SRCINFO` con `pkgbase = apohara-catalyst-bin` etc.

- [ ] **Step 3: Verify PKGBUILD válido**

Run: `cd dist/aur/apohara-catalyst-bin && namcap PKGBUILD`
Expected: 0 errors. Warnings sobre SKIP sha256sums son OK (placeholder hasta release).

- [ ] **Step 4: Commit**

```bash
git add dist/aur/apohara-catalyst-bin/PKGBUILD dist/aur/apohara-catalyst-bin/.SRCINFO
git commit -m "dist(aur): PKGBUILD for apohara-catalyst-bin (G4.B.2)

Binary AUR package downloads from GitHub Releases. sha256sums=SKIP
hasta release real (G4.C.3 actualiza). namcap clean.

Upload a AUR gated por sign-off."
```

### Task G4.B.3: Implementer 2 — Homebrew formula

**Files:**
- Create: `dist/homebrew/apohara-catalyst.rb`

- [ ] **Step 1: Crear formula**

```bash
mkdir -p dist/homebrew
```

```ruby
# dist/homebrew/apohara-catalyst.rb
class ApoharaCatalyst < Formula
  desc "Local-first multi-AI orchestrator with formal safety invariants"
  homepage "https://github.com/SuarezPM/apohara-catalyst"
  version "1.0.0"
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    on_arm do
      url "https://github.com/SuarezPM/apohara-catalyst/releases/download/v1.0.0/apohara-aarch64-apple-darwin"
      sha256 "REPLACE_WITH_REAL_SHA256_AT_RELEASE"
    end
    on_intel do
      url "https://github.com/SuarezPM/apohara-catalyst/releases/download/v1.0.0/apohara-x86_64-apple-darwin"
      sha256 "REPLACE_WITH_REAL_SHA256_AT_RELEASE"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/SuarezPM/apohara-catalyst/releases/download/v1.0.0/apohara-aarch64-unknown-linux-gnu"
      sha256 "REPLACE_WITH_REAL_SHA256_AT_RELEASE"
    end
    on_intel do
      url "https://github.com/SuarezPM/apohara-catalyst/releases/download/v1.0.0/apohara-x86_64-unknown-linux-gnu"
      sha256 "REPLACE_WITH_REAL_SHA256_AT_RELEASE"
    end
  end

  def install
    bin.install Dir["apohara*"][0] => "apohara"
  end

  test do
    system "#{bin}/apohara", "--version"
  end
end
```

- [ ] **Step 2: Verify formula syntax**

```bash
# Si brew instalado:
brew style dist/homebrew/apohara-catalyst.rb 2>&1 | head -20
# O básica check ruby syntax:
ruby -c dist/homebrew/apohara-catalyst.rb
```

Expected: "Syntax OK" o style warnings tolerables (SHA256 placeholder, expected).

- [ ] **Step 3: Commit**

```bash
git add dist/homebrew/apohara-catalyst.rb
git commit -m "dist(homebrew): formula for apohara-catalyst (G4.B.3)

Multi-arch (arm64/intel) × multi-OS (macOS/Linux) bottle stub.
sha256 placeholders replaced al release time (G4.C.3).

Tap (homebrew-tap repo) deploy gated por sign-off."
```

### Task G4.B.4: Implementer 2 — Scoop manifest

**Files:**
- Create: `dist/scoop/apohara-catalyst.json`

- [ ] **Step 1: Crear manifest**

```bash
mkdir -p dist/scoop
```

```json
{
  "version": "1.0.0",
  "description": "Local-first multi-AI orchestrator with formal safety invariants",
  "homepage": "https://github.com/SuarezPM/apohara-catalyst",
  "license": "MIT OR Apache-2.0",
  "url": "https://github.com/SuarezPM/apohara-catalyst/releases/download/v1.0.0/apohara-x86_64-pc-windows-msvc.exe",
  "hash": "REPLACE_WITH_REAL_SHA256_AT_RELEASE",
  "bin": [
    [
      "apohara-x86_64-pc-windows-msvc.exe",
      "apohara"
    ]
  ],
  "checkver": {
    "github": "https://github.com/SuarezPM/apohara-catalyst"
  },
  "autoupdate": {
    "url": "https://github.com/SuarezPM/apohara-catalyst/releases/download/v$version/apohara-x86_64-pc-windows-msvc.exe"
  }
}
```

- [ ] **Step 2: Verify JSON syntactic**

```bash
python3 -c "import json; json.load(open('dist/scoop/apohara-catalyst.json'))" && echo OK
```

Expected: "OK".

- [ ] **Step 3: Commit**

```bash
git add dist/scoop/apohara-catalyst.json
git commit -m "dist(scoop): manifest for apohara-catalyst (G4.B.4)

Single x86_64-pc-windows-msvc target. autoupdate uses GitHub Releases.
SHA256 placeholder replaced al release (G4.C.3). Bin renamed apohara.exe.

Manifest commit a SuarezPM/scoop-bucket gated por sign-off."
```

### Task G4.B.5: Implementer 1 — GitHub Release upload step en release.yml

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add release job que publica artifacts**

Append a `release.yml`:

```yaml
  publish-release:
    name: publish-github-release
    needs: build
    runs-on: ubuntu-22.04
    if: startsWith(github.ref, 'refs/tags/v')
    steps:
      - uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: dist/

      - name: Flatten + compute checksums
        run: |
          mkdir -p flat
          find dist/ -type f -name "apohara-*" -not -name "SHA256SUMS*" -exec cp {} flat/ \;
          cd flat
          sha256sum * > SHA256SUMS
          cat SHA256SUMS

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: flat/*
          generate_release_notes: true
          draft: true  # IMPORTANTE: draft=true para que Pablo apruebe antes de publicar
          body: |
            Apohara Catalyst ${{ github.ref_name }} release artifacts.

            See SHA256SUMS for binary verification.

            Install via:
            - `cargo install apohara`
            - AUR `yay -S apohara-catalyst-bin`
            - Homebrew `brew install apohara-catalyst`
            - Scoop `scoop install apohara-catalyst`
            - Direct download below + chmod +x.
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): publish-github-release job creates draft release (G4.B.5)

Aggregates all 5 build artifacts + SHA256SUMS into single Release.
draft=true para que Pablo revise antes de publicar — sign-off compatible.
Trigger por tag push v*.*.*.

Release publish (draft → published) gated por Pablo en GitHub UI."
```

### Task G4.B.6: Sprint 24 cierre

- [ ] **Step 1: Verify all distribution paths**

```bash
ls -la dist/aur/apohara-catalyst-bin/
ls -la dist/homebrew/
ls -la dist/scoop/
cargo publish --dry-run -p apohara --allow-dirty 2>&1 | tail -3
```

Expected: archivos exist + dry-run no errors.

- [ ] **Step 2: Sprint 24 cierre commit**

```bash
git commit --allow-empty -m "chore(sprint): S24 distribution packaging COMPLETE (5 channels)

Ready to publish (gated por sign-off):
- crates.io (cargo publish --dry-run passes)
- AUR PKGBUILD validado (namcap clean)
- Homebrew formula style-clean
- Scoop manifest JSON-valid
- GitHub Release workflow creates draft on tag push

Sprint 25 (sign-off + launch) arranca."
```

---

## G4.C — Sprint 25 Sign-off + launch operacional (3d, 1 implementer + Pablo)

**Outcome esperado**: Sign-off doc actualizado con evidencia Phase 1-3. Pablo firma. Implementer dispara secuencia launch (tag → workflow → draft release → cargo publish → AUR push → Homebrew tap → Scoop manifest → GitHub Release publish). Repo público + v1.0.0 live en TODOS los channels simultáneamente.

> **HARD HALT GATE**: cada step en G4.C.2-7 está GATED por sign-off firmado. Si Pablo no firma → mensaje + esperar. NO ejecutar ningún command irreversible sin firma.

### Task G4.C.1: Actualizar sign-off doc con evidencia Phase 1-3

**Files:**
- Modify: `docs/superpowers/pre-release-validation/sign-off.md`

- [ ] **Step 1: Verificar evidencia per Phase**

```bash
# Phase 1: 7 crates + apohara binary
cargo test --workspace 2>&1 | tail -5
ls target/release/apohara
./target/release/apohara doctor
# Phase 2: 0 TS source + Dioxus UI
find . -name "*.ts" -not -path "./node_modules/*" -not -path "./target/*" -not -path "./.git/*" | wc -l
ls target/release/apohara-desktop-dioxus
# Phase 3: TUI + cache + Z3
ls target/release/apohara-tui
cargo test -p apohara-safety inv_bash_scope 2>&1 | tail -3
cargo test -p apohara-verification inv_bash_scope_gate 2>&1 | tail -3
cargo bench -p apohara-prompt-cache -- --quick 2>&1 | tail -10
```

Implementer captura output para incluir en sign-off.

- [ ] **Step 2: Editar sign-off.md**

```markdown
# Apohara Catalyst v1.0.0 — Release Sign-off

## Phase 1 — Rust Core Ports (S12-S15)

- [x] cargo test --workspace green ([VALORES])
- [x] apohara binary boots (./target/release/apohara --version)
- [x] apohara doctor exits 0 or 2
- [x] 7 nuevas crates: apohara-{dispatch,verification,safety,spec,mcp,hooks,decomposer,projector}
- [x] Feature flags APOHARA_RUST_* default ON (G1.D.2 commit)

## Phase 2 — UI Rewrite (S16-S19)

- [x] Dioxus bake-off GO decision (G2.A.6)
- [x] 14 brand components portados (G2.B + G2.C)
- [x] HTML5 native DnD reemplaza @hello-pangea/dnd
- [x] alacritty_terminal + syntect + petgraph hard components
- [x] Cero TS source en repo (find . -name "*.ts" wc -l = 0)
- [x] apohara-desktop-dioxus boots + UI completa

## Phase 3 — TUI + ContextForge + Z3 (S20-S22)

- [x] apohara-tui ratatui boots con 4 views
- [x] apohara-context-primitives: SimHash + LSH + Queueing tested
- [x] apohara-prompt-cache: HOT + WARM + L1/L2/L3 tested
- [x] Latency budget guardrail 5000μs activo
- [x] Z3 INV-bash-scope proof passes
- [x] verification-mesh enforces INV-bash-scope
- [x] CI z3-proof job green

## Phase 4 — Distribution (S23-S24)

- [x] 5 cross-platform builds en CI matrix
- [x] crates.io metadata complete (cargo publish --dry-run)
- [x] AUR PKGBUILD validado
- [x] Homebrew formula style-clean
- [x] Scoop manifest JSON-valid
- [x] GitHub Release workflow tested (draft mode)

## Final smoke checks

- [x] cargo test --workspace verde
- [x] cargo build --release --workspace verde
- [x] All 5 binaries boot (smoke)
- [x] doctor + verify-setup pass
- [x] Z3 proof + verification-mesh gates pre-merge

## Pablo signature

**By signing below, Pablo authorizes:**
1. Publishing `apohara` v1.0.0 a crates.io
2. Uploading PKGBUILD a AUR
3. Publishing Homebrew formula
4. Committing Scoop manifest
5. Publishing GitHub Release v1.0.0 (draft → public)
6. Pushing branch `feat/apohara-catalyst` + tag `v1.0.0` a remote
7. Making repo public (si no lo era ya)

---

**Pablo signature**: ________________________

**Date**: ________________________

---
```

- [ ] **Step 3: Commit + mensaje a Pablo**

```bash
git add docs/superpowers/pre-release-validation/sign-off.md
git commit -m "docs(sign-off): Phase 1-3 evidence + Phase 4 staging complete (G4.C.1)

All evidence captured. Awaiting Pablo signature antes de cualquier
acción irreversible (publish/push)."
```

> **HALT GATE — mensaje a Pablo**:
>
> "Sign-off doc actualizado en `docs/superpowers/pre-release-validation/sign-off.md` con evidencia completa de Phase 1-3 + Phase 4 staging. Necesito tu firma para arrancar la secuencia launch:
>
> 1. cargo publish (irreversible — 24h yank window only)
> 2. AUR push (visible al ecosistema Arch)
> 3. Homebrew tap deploy
> 4. Scoop manifest commit
> 5. GitHub Release publish (draft → public)
> 6. Git push branch + tag v1.0.0
>
> Cuando estés listo, firmá el doc o respondé 'firmado'. Si querés revisar algo antes, todo lo previo está commiteado."

### Task G4.C.2: cargo publish a crates.io (POST SIGNATURE)

> **HALT GATE**: SOLO ejecutar si sign-off firmado.

- [ ] **Step 1: Verificar sign-off firmado**

Run: `grep -A2 "Pablo signature" docs/superpowers/pre-release-validation/sign-off.md`
Expected: línea NO vacía después de "Pablo signature:". Si vacío → STOP + mensaje a Pablo.

- [ ] **Step 2: Tag v1.0.0**

```bash
git tag -a v1.0.0 -m "Apohara Catalyst v1.0.0 — Pure Rust Native release

Phase 1-4 complete:
- Rust core ports (11 new crates ~51k LOC)
- 100% Rust UI via Dioxus (zero TS in repo)
- ContextForge integration (SimHash + LSH + Queueing + 2-tier cache)
- Z3 SMT formal proof INV-bash-scope enforced
- Cross-platform binaries (5 targets)
- 5 distribution channels active

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 3: cargo publish (orden estricto por dependencies)**

```bash
# Orden importa: dependencies primero
for crate in \
  apohara-types apohara-pathsafety apohara-secrets apohara-audit \
  apohara-context-primitives apohara-token-accounting apohara-coordinator \
  apohara-worktree apohara-sandbox apohara-indexer apohara-attention \
  apohara-anti-thrash apohara-notifications apohara-persistence \
  apohara-mcp-bridge apohara-event-humanizer apohara-hooks-server \
  apohara-prompt-cache apohara-safety apohara-spec apohara-verification \
  apohara-mcp apohara-hooks apohara-decomposer apohara-projector \
  apohara-dispatch apohara-tui apohara-desktop-dioxus apohara; do
  echo "=== Publishing $crate ==="
  cargo publish -p "$crate" --token "$CARGO_REGISTRY_TOKEN"
  sleep 30 # crates.io indexing lag entre publishes dependientes
done
```

(Token de Pablo. NO hardcodear. Pasarse via env var antes de ejecutar.)

- [ ] **Step 4: Verify**

```bash
# Wait ~1 min para crates.io indexing
cargo search apohara | head -5
# Esperado: listing con version 1.0.0
```

- [ ] **Step 5: Commit del sign-off update**

Edit `docs/superpowers/pre-release-validation/sign-off.md`:
```markdown
## Publish progress

- [x] [DATE] crates.io publish complete (27 crates published)
```

```bash
git add docs/superpowers/pre-release-validation/sign-off.md
git commit -m "release: crates.io publish complete (v1.0.0) (G4.C.2)

27 crates publicadas: apohara-types ... apohara. cargo install apohara
works. Indexing complete.

Next: AUR + Homebrew + Scoop + GitHub Release."
```

### Task G4.C.3: Replace SHA256 placeholders + AUR push

**Files:**
- Modify: `dist/aur/apohara-catalyst-bin/PKGBUILD`
- Modify: `dist/homebrew/apohara-catalyst.rb`
- Modify: `dist/scoop/apohara-catalyst.json`

- [ ] **Step 1: Trigger tag-based release workflow**

```bash
git push origin v1.0.0  # REQUIERE auth
gh run watch  # esperar workflow completion
gh release view v1.0.0
```

- [ ] **Step 2: Capturar SHA256 real**

```bash
gh release download v1.0.0 --pattern "SHA256SUMS" -D /tmp/release-sums
cat /tmp/release-sums/SHA256SUMS
```

- [ ] **Step 3: Update PKGBUILD sha256sums**

Replace `SKIP` con valores reales:

```bash
SHA_X86=$(grep "apohara-x86_64-unknown-linux-gnu$" /tmp/release-sums/SHA256SUMS | cut -d' ' -f1)
SHA_ARM=$(grep "apohara-aarch64-unknown-linux-gnu$" /tmp/release-sums/SHA256SUMS | cut -d' ' -f1)

sed -i "s/sha256sums_x86_64=('SKIP')/sha256sums_x86_64=('$SHA_X86')/" dist/aur/apohara-catalyst-bin/PKGBUILD
sed -i "s/sha256sums_aarch64=('SKIP')/sha256sums_aarch64=('$SHA_ARM')/" dist/aur/apohara-catalyst-bin/PKGBUILD

cd dist/aur/apohara-catalyst-bin
makepkg --printsrcinfo > .SRCINFO
```

- [ ] **Step 4: AUR push (requires AUR SSH key set up)**

```bash
# Asumiendo AUR account "pablosuarez" con SSH key configurada
# Pablo debe haber hecho `ssh-keygen` + `cat ~/.ssh/id_ed25519.pub` → AUR account
git clone ssh://aur@aur.archlinux.org/apohara-catalyst-bin.git /tmp/aur-clone
cp -v dist/aur/apohara-catalyst-bin/PKGBUILD /tmp/aur-clone/
cp -v dist/aur/apohara-catalyst-bin/.SRCINFO /tmp/aur-clone/
cd /tmp/aur-clone
git add PKGBUILD .SRCINFO
git commit -m "v1.0.0: initial release"
git push  # REQUIERE auth Pablo
```

- [ ] **Step 5: Update Homebrew formula con SHA256 reales**

```bash
SHA_DARWIN_ARM=$(grep "apohara-aarch64-apple-darwin$" /tmp/release-sums/SHA256SUMS | cut -d' ' -f1)
SHA_DARWIN_INTEL=$(grep "apohara-x86_64-apple-darwin$" /tmp/release-sums/SHA256SUMS | cut -d' ' -f1)
SHA_LINUX_ARM=$(grep "apohara-aarch64-unknown-linux-gnu$" /tmp/release-sums/SHA256SUMS | cut -d' ' -f1)
SHA_LINUX_INTEL=$(grep "apohara-x86_64-unknown-linux-gnu$" /tmp/release-sums/SHA256SUMS | cut -d' ' -f1)

# Use sed para reemplazar los 4 placeholders en orden correcto
# (Implementer edita manualmente si sed regex falla — son 4 ocurrencias en orden conocido)
```

- [ ] **Step 6: Homebrew tap push**

```bash
# Pablo debe tener creado SuarezPM/homebrew-tap repo en GitHub (público)
git clone https://github.com/SuarezPM/homebrew-tap.git /tmp/homebrew-tap-clone
mkdir -p /tmp/homebrew-tap-clone/Formula
cp dist/homebrew/apohara-catalyst.rb /tmp/homebrew-tap-clone/Formula/
cd /tmp/homebrew-tap-clone
git add Formula/apohara-catalyst.rb
git commit -m "feat: apohara-catalyst v1.0.0 initial release"
git push  # REQUIERE auth Pablo
```

User install path:
```bash
brew tap suarezpm/tap
brew install apohara-catalyst
```

- [ ] **Step 7: Scoop bucket push**

```bash
SHA_WIN=$(grep "apohara-x86_64-pc-windows-msvc.exe$" /tmp/release-sums/SHA256SUMS | cut -d' ' -f1)
sed -i "s/REPLACE_WITH_REAL_SHA256_AT_RELEASE/$SHA_WIN/" dist/scoop/apohara-catalyst.json

# Pablo debe tener creado SuarezPM/scoop-bucket repo
git clone https://github.com/SuarezPM/scoop-bucket.git /tmp/scoop-bucket-clone
cp dist/scoop/apohara-catalyst.json /tmp/scoop-bucket-clone/
cd /tmp/scoop-bucket-clone
git add apohara-catalyst.json
git commit -m "feat: apohara-catalyst v1.0.0 initial release"
git push  # REQUIERE auth Pablo
```

User install path:
```powershell
scoop bucket add suarezpm https://github.com/SuarezPM/scoop-bucket
scoop install apohara-catalyst
```

- [ ] **Step 8: Update sign-off**

```bash
# Edit docs/superpowers/pre-release-validation/sign-off.md publish progress section:
# - [x] [DATE] AUR upload complete (aur.archlinux.org/packages/apohara-catalyst-bin)
# - [x] [DATE] Homebrew tap deploy complete (SuarezPM/homebrew-tap)
# - [x] [DATE] Scoop manifest committed (SuarezPM/scoop-bucket)

git add docs/superpowers/pre-release-validation/sign-off.md dist/aur/apohara-catalyst-bin/PKGBUILD dist/aur/apohara-catalyst-bin/.SRCINFO dist/homebrew/apohara-catalyst.rb dist/scoop/apohara-catalyst.json
git commit -m "release: AUR + Homebrew + Scoop deploy complete (v1.0.0) (G4.C.3)

SHA256 placeholders reemplazados con sums reales de GitHub Release.
Push a 3 distribution repos. Users pueden instalar via package managers."
```

### Task G4.C.4: GitHub Release draft → published

- [ ] **Step 1: Review draft release**

```bash
gh release view v1.0.0 --json isDraft -q .isDraft
```

Expected: `true` (current state from workflow).

- [ ] **Step 2: Edit release body si necesario**

```bash
gh release edit v1.0.0 --notes-file RELEASE_NOTES.md
```

(Implementer reviewa que `RELEASE_NOTES.md` describe Phase 1-3 deliverables.)

- [ ] **Step 3: Publish (un-draft)**

```bash
gh release edit v1.0.0 --draft=false
# Verify
gh release view v1.0.0 --json isDraft -q .isDraft
```

Expected: `false`.

- [ ] **Step 4: Commit sign-off update**

```bash
# Edit sign-off.md:
# - [x] [DATE] GitHub Release v1.0.0 publicada (https://github.com/SuarezPM/apohara-catalyst/releases/tag/v1.0.0)

git add docs/superpowers/pre-release-validation/sign-off.md
git commit -m "release: GitHub Release v1.0.0 publicada (draft → public) (G4.C.4)"
```

### Task G4.C.5: Push branch + tag a remote

- [ ] **Step 1: Verify branch state**

```bash
git status
# Esperado: clean, en feat/apohara-catalyst
git log --oneline -5
# Esperado: últimos commits son G4.C.* + Phase cierres
```

- [ ] **Step 2: Push branch + tag (REQUIRES Pablo authorization)**

> **HARD HALT**: Aunque sign-off firmado, push remoto es revealing. Verificar con Pablo que está OK push branch público.

```bash
git push origin feat/apohara-catalyst  # REQUIERE auth
# (tag v1.0.0 already pushed en G4.C.3 Step 1)
```

- [ ] **Step 3: Optional: open PR to main**

```bash
gh pr create --base main --head feat/apohara-catalyst \
  --title "feat: Apohara Catalyst v1.0.0 — Pure Rust Native release" \
  --body "$(cat <<'EOF'
## Summary

- Phase 1: Rust core ports (11 new crates ~51k LOC)
- Phase 2: 100% Rust UI via Dioxus (zero TS in repo)
- Phase 3: ContextForge integration + Z3 SMT formal proof INV-bash-scope
- Phase 4: 5 cross-platform builds + 5 distribution channels

See sign-off doc: docs/superpowers/pre-release-validation/sign-off.md

## Test plan

- [x] cargo test --workspace green
- [x] All 5 binaries boot
- [x] Z3 proof CI green
- [x] crates.io publish complete
- [x] AUR + Homebrew + Scoop deploy complete
- [x] GitHub Release v1.0.0 published

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Commit local**

```bash
git commit --allow-empty -m "chore(release): branch + tag pushed to remote (G4.C.5)

feat/apohara-catalyst pushed. PR opened to main. Pablo merge-decision
pending review."
```

### Task G4.C.6: Public announcement

> **HALT GATE**: Public announcement requiere Pablo decision sobre WHERE (Twitter / Reddit / HN / etc.) y exact wording.

- [ ] **Step 1: Preparar draft announcement**

Crear `dist/announcement/v1.0.0-draft.md`:

```markdown
# Apohara Catalyst v1.0.0 — local-first multi-AI orchestrator

After 70 days of subagent-driven autonomous development, **Apohara Catalyst v1.0.0** is live.

## What

A 100% Rust orchestrator that runs claude-code-cli, codex-cli, opencode-go locally — no API keys, no cloud relay. Z3 SMT formal proof on every compound bash command.

## Highlights

- Pure Rust source (CLI + Tauri/Dioxus desktop + ratatui TUI)
- Local-first: CLI wrappers respect user subscriptions, no OAuth
- Apohara ContextForge primitives ported to Rust (SimHash + LSH + Queueing)
- 2-tier prompt cache HOT/WARM with 3 layers safety
- Z3 INV-bash-scope enforced via verification-mesh
- 5 distribution channels: cargo / AUR / Homebrew / Scoop / GitHub Releases

## Install

```bash
cargo install apohara
# or
yay -S apohara-catalyst-bin
# or
brew install suarezpm/tap/apohara-catalyst
# or
scoop bucket add suarezpm https://github.com/SuarezPM/scoop-bucket
scoop install apohara-catalyst
```

Repo: https://github.com/SuarezPM/apohara-catalyst
```

- [ ] **Step 2: Mensaje a Pablo**

> **HALT GATE — Pablo decision**:
>
> "Apohara Catalyst v1.0.0 está live en los 5 channels. Tengo draft de announcement en `dist/announcement/v1.0.0-draft.md`. Cuándo y dónde lo publicamos? Opciones:
>
> 1. Twitter/X (cuenta @SuarezPM si existe)
> 2. r/rust + r/programming
> 3. Hacker News
> 4. dev.to / Lobste.rs
> 5. Combinación de las anteriores
> 6. Skip por ahora — quiero que se asiente primero
>
> Sugerencia: opción 6 + tweet teaser + esperar feedback orgánico de cargo install."

- [ ] **Step 3: Commit draft**

```bash
git add dist/announcement/v1.0.0-draft.md
git commit -m "docs(launch): announcement draft v1.0.0 (G4.C.6)

Channels + copy preparado. Public posting gated por Pablo decision."
```

### Task G4.C.7: Phase 4 + v1.0.0 cierre

- [ ] **Step 1: Final smoke**

```bash
cargo install apohara 2>&1 | tail -3
which apohara
apohara --version
apohara doctor
```

Expected: install via crates.io exitoso. Version 1.0.0. doctor exits clean.

- [ ] **Step 2: Update tracking doc + sign-off final**

```markdown
# Edit phase-4-launch-tracker.md: marcar TODOS los rows como DONE.
# Edit sign-off.md: agregar timestamp final.
```

- [ ] **Step 3: Phase 4 + v1.0.0 cierre empty commit**

```bash
git commit --allow-empty -m "chore(release): Apohara Catalyst v1.0.0 LAUNCHED

Phase 4 complete. v1.0.0 live en 5 channels:
- crates.io: cargo install apohara
- AUR: yay -S apohara-catalyst-bin
- Homebrew: brew install suarezpm/tap/apohara-catalyst
- Scoop: scoop install apohara-catalyst
- GitHub Releases: https://github.com/SuarezPM/apohara-catalyst/releases/tag/v1.0.0

70 días de subagent-driven autonomous development cerrados.

Sign-off: docs/superpowers/pre-release-validation/sign-off.md

🚀 v1.0.0"
```

---

## Self-Review

**1. Spec coverage**:
- §4 Phase 4 (S23-S25): G4.A → S23, G4.B → S24, G4.C → S25 ✓
- §5 Distribution channels: 5 channels documentados con install commands ✓
- §5 Build pipeline: 5 targets en CI matrix ✓
- §5 Apple notarization + Windows signing: gated by secrets (G4.A.3) opcional ✓

**2. HALT GATES**:
- G4.A.2 Step 1: workflow trigger requires Pablo auth ✓
- G4.A.3 Step 1: signing certs check requires Pablo ✓
- G4.C.1 mensaje a Pablo: sign-off awaiting signature ✓
- G4.C.2 Step 1: pre-publish verifica firma en doc ✓
- G4.C.3 Step 4/6/7: AUR + Homebrew + Scoop pushes requires Pablo auth ✓
- G4.C.5 Step 2: branch push requires Pablo auth ✓
- G4.C.6 Step 2: announcement channel decision requires Pablo ✓

**3. Placeholder scan**:
- "REPLACE_WITH_REAL_SHA256_AT_RELEASE" / "SKIP" / "[VALUE]" / "[DATE]" / "[VALORES]" son intencionales — gets filled at execution time (no Z3-proof-style real placeholders). Implementer reemplaza con observed values.

**4. NO TDD pattern intencional**: este plan es operacional — packaging + distribution + sign-off. No new code logic, no failing tests. Commands son exact + each step is verifiable.

**5. Reversibility considerations**:
- crates.io publish: 24h yank window (mitigable pero no fully reversible) — gated por sign-off.
- AUR/Homebrew/Scoop pushes: revertible via subsequent commits removing manifests.
- GitHub Release publish: revertible (delete release retains tag).
- Branch push: revertible (force-push delete; no destructive ops sin Pablo OK).
- Tag push: revertible (`git push origin :refs/tags/v1.0.0`).

**6. Workflow defensiveness**:
- GitHub Release publishes como `draft=true` por default — Pablo reviews antes de un-drafting.
- cargo publish loop tiene `sleep 30` entre crates para indexing lag.
- Tag pushes están explicit en cierre (no auto-trigger desde local push).

---

*Fin del plan Phase 4 — operational launch.*
