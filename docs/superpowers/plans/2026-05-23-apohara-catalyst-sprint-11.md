# Apohara Catalyst Sprint 11 — Launch Runbook

> **For agentic workers:** Este sprint es OPERACIONAL — sin TDD bite-sized. Steps son checklist sequencial. Cada step se ejecuta y luego se commitea/anota el artifact resultante. Pablo aprueba explícitamente cada acción destructiva (push, publish, tag remote).

**Goal:** Publicar Apohara Catalyst v1.0.0 al mundo: npm publish `@apohara/catalyst@1.0.0`, tag git `v1.0.0` pushed, GitHub Release creado con notes + binary attachments, README badges actualizados, smoke post-launch desde npm registry, mascot social posts si Pablo quiere.

**Architecture:** 4 grupos secuenciales (no paralelos — el orden importa). G11.A pre-launch sign-off. G11.B publish. G11.C post-launch verify. G11.D announce. Pablo debe aprobar explícitamente cada step que toca remote (push, publish, tag).

**Tech Stack:** `gh` (GitHub CLI), `npm publish`, `git push`, GitHub Releases.

---

## Estructura del Sprint 11

### 4 grupos secuenciales

| Grupo | Tema | # tareas | Esfuerzo |
|---|---|---:|---:|
| **G11.A** | Pre-launch sign-off | 4 | 0.5 día |
| **G11.B** | Publish artifacts | 4 | 0.5 día |
| **G11.C** | Post-launch verify | 3 | 0.5 día |
| **G11.D** | Announce | 3 | 0.5 día |

**Total**: 14 steps, ~1.5-2 días — un solo implementer (orden importa, no paralelizable).

---

## G11.A — Pre-launch sign-off (4 steps)

**Outcome**: Branch ready, reports G10.A-D todos PROCEED, RELEASE_NOTES draft listo, Pablo sign-off escrito.

### Step G11.A.1: Verificar reports G10.A-D

- [ ] Confirmar cada report tiene "Conclusión: PROCEED":

```bash
for f in docs/superpowers/pre-release-validation/g10-*.md; do
  echo "=== $f ==="
  grep -A 1 "## Conclusión" "$f"
done
```

Si algún report dice BLOCK → STOP el launch y resolver el blocker antes de continuar.

### Step G11.A.2: Bumear version a 1.0.0 final

- [ ] **Editar `npx-cli/package.json`**: `"version": "1.0.0-rc.1"` → `"version": "1.0.0"`.

- [ ] **Editar `Cargo.toml` workspace.package**: `version = "1.0.0"` (puede que ya esté; verificar).

- [ ] **Commit**:

```bash
git add npx-cli/package.json Cargo.toml
git commit -m "chore(release): bump version to 1.0.0 for launch (G11.A.2)"
```

### Step G11.A.3: Draft RELEASE_NOTES.md

- [ ] **Crear `RELEASE_NOTES.md`** en root:

```markdown
# Apohara Catalyst v1.0.0

> Local-first multi-AI orchestrator. Catalyzes parallel dispatch across
> Claude Code, Codex, and OpenCode CLIs to slash Time-To-First-Token
> without consuming additional tokens from your subscriptions.

## What's new in 1.0.0

This is the first public release. Highlights:

### Orchestration
- Spec → tasks decomposition with verification mesh
- Parallel dispatch across 3 CLI providers (Claude Code / Codex / OpenCode)
- Git worktree isolation per agent — no cross-talk, no file conflicts
- SQLite (bun:sqlite + Rust SQLx) for all state; zero cloud dependency

### Brand: Catalyst
- New pixel-art identity (lime + ink palette, Press Start 2P display font)
- Chief mascot animates with orchestrator state
- Kanban view with drag-and-drop status updates
- Cmd+K command palette across the desktop UI

### Safety & isolation
- Sandbox via seccomp-bpf + namespaces (Linux)
- Path-safety with symlink-escape detection
- Atomic file writes (mkstemp + fdatasync + rename)
- Env sanitizer — no API keys leak to spawned CLIs
- OS-native credential store via keyring-rs

### Local-first
- No telemetry by default (opt-in only)
- Crash reports stored locally; "Send to Apohara" button is explicit
- No OAuth, no cloud sync — your subscriptions stay yours

## Install

```bash
npm install -g @apohara/catalyst
apohara doctor
apohara
```

## Compatibility

- Linux (Ubuntu 22.04+, Arch, CachyOS, Fedora 39+)
- macOS 14+
- Windows 11 + WSL2

## Acknowledgments

This release stands on the shoulders of these projects:
- **orca** (https://github.com/oraios/orca) — AgentStateDot + ConfirmationDialogProvider patterns
- **chorus** — PixelCanvas approach
- **vibe-kanban** — @hello-pangea/dnd Kanban + animated running border
- Brand identity inspired by sister projects Apohara Probant + Apohara Consilium

## Roadmap (post-1.0)

- v1.1: smart router (cost/latency-aware dispatch), reactions, remote workers (opt-in)
- v1.2: demo video tooling + comparative benchmarks
- v2.0: TBD — community input gating major changes

---

🤖 Made with Apohara Catalyst orchestrating itself.
```

- [ ] **Commit**:

```bash
git add RELEASE_NOTES.md
git commit -m "docs(release): draft RELEASE_NOTES.md for v1.0.0 (G11.A.3)"
```

### Step G11.A.4: Sign-off form

- [ ] **Crear `docs/superpowers/pre-release-validation/sign-off.md`**:

```markdown
# Apohara Catalyst v1.0.0 — Pre-Launch Sign-Off

## Reports

- ✅ G10.A cross-platform: PROCEED
- ✅ G10.B security: PROCEED
- ✅ G10.C performance: PROCEED
- ✅ G10.D doctor: PROCEED

## Pablo sign-off

I, Pablo Suarez, approve the launch of @apohara/catalyst@1.0.0.

This authorizes the following destructive/public actions:
- `git push origin feat/apohara-catalyst:main` (or PR + merge if branch protection on)
- `git tag v1.0.0 && git push origin v1.0.0`
- `npm publish` from `npx-cli/`
- `gh release create v1.0.0 --notes-file RELEASE_NOTES.md`
- Public Twitter/X / blog post / community announcement

Signed: ___ (Pablo writes initials here on launch day)
Date: ___ (filled on launch day)
```

- [ ] **Commit**:

```bash
git add docs/superpowers/pre-release-validation/sign-off.md
git commit -m "docs(release): pre-launch sign-off form (G11.A.4)"
```

**ESTOP**: Esperar firma de Pablo en `sign-off.md` antes de continuar a G11.B.

---

## G11.B — Publish artifacts (4 steps)

**Outcome**: Code en main, tag v1.0.0 pushed, npm package live, GitHub Release publicado.

### Step G11.B.1: Merge a main

- [ ] **Crear PR (no push directo a main per regla durable de Pablo)**:

```bash
gh pr create \
  --base main \
  --head feat/apohara-catalyst \
  --title "Release v1.0.0 — Apohara Catalyst" \
  --body-file RELEASE_NOTES.md
```

- [ ] **Esperar approve de Pablo + merge**:

```bash
gh pr view --json reviewDecision --jq .reviewDecision
# Esperar APPROVED
gh pr merge --squash --auto
```

- [ ] **Sync local main**:

```bash
git checkout main
git pull --ff-only
```

### Step G11.B.2: Tag y push del tag

**ESTOP**: Confirmación explícita de Pablo: "OK push tag v1.0.0".

- [ ] **Crear tag firmado**:

```bash
git tag -s v1.0.0 -m "Apohara Catalyst v1.0.0 — public launch"
git push origin v1.0.0
```

Si Pablo no tiene GPG configurado, usar `-a` en lugar de `-s`:

```bash
git tag -a v1.0.0 -m "Apohara Catalyst v1.0.0 — public launch"
git push origin v1.0.0
```

### Step G11.B.3: npm publish

**ESTOP**: Confirmación explícita de Pablo: "OK npm publish @apohara/catalyst@1.0.0".

- [ ] **Login npm**:

```bash
npm whoami || npm login
```

- [ ] **Build clean**:

```bash
cd npx-cli
rm -rf dist node_modules
bun install
bun run build
```

- [ ] **Dry-run primero**:

```bash
npm publish --dry-run --access public
```

Verificar tarball name `apohara-catalyst-1.0.0.tgz`, archivos listados son los esperados (dist/, README.md, package.json).

- [ ] **Publish real**:

```bash
npm publish --access public
```

- [ ] **Verificar en registry**:

```bash
npm view @apohara/catalyst@1.0.0
```

### Step G11.B.4: GitHub Release

- [ ] **Crear release attached al tag**:

```bash
gh release create v1.0.0 \
  --title "Apohara Catalyst v1.0.0" \
  --notes-file RELEASE_NOTES.md \
  --verify-tag
```

- [ ] **(Opcional) Attach binary builds**:

Si Tauri build está disponible y firmado:

```bash
gh release upload v1.0.0 \
  target/release/bundle/deb/apohara-catalyst_1.0.0_amd64.deb \
  target/release/bundle/dmg/apohara-catalyst_1.0.0_x64.dmg \
  target/release/bundle/msi/apohara-catalyst_1.0.0_x64.msi \
  --clobber
```

Si Tauri build no es parte del scope v1.0.0, dejar el release como source-only (npm es el canal principal).

- [ ] **Verificar en GitHub**:

```bash
gh release view v1.0.0
```

---

## G11.C — Post-launch verify (3 steps)

**Outcome**: Confirmar que un usuario externo puede instalar y correr desde la primera línea.

### Step G11.C.1: Fresh install desde registry público

- [ ] **En máquina/contenedor limpio**:

```bash
docker run --rm -it -v /tmp:/tmp node:20 bash -c '
  npm install -g @apohara/catalyst
  apohara --version
  apohara doctor || [ $? -eq 2 ]
'
```

Expected: install completa sin warnings, `apohara --version` imprime `1.0.0`, `doctor` exit 0 o 2.

### Step G11.C.2: Verificar README badges live

- [ ] **Update README badges**:

```markdown
[![npm version](https://img.shields.io/npm/v/@apohara/catalyst.svg)](https://www.npmjs.com/package/@apohara/catalyst)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Release](https://img.shields.io/github/v/release/SuarezPM/apohara)](https://github.com/SuarezPM/apohara/releases/latest)
```

Insertar al tope del README, debajo del título.

- [ ] **Commit + push a main**:

```bash
git checkout main
git pull --ff-only
# Edit README.md
git add README.md
git commit -m "docs(readme): add npm + GitHub release badges post-launch (G11.C.2)"
git push origin main
```

### Step G11.C.3: Smoke `apohara doctor` desde install live

- [ ] **En la máquina de Pablo**:

```bash
npm install -g @apohara/catalyst
apohara doctor
```

Documentar resultado en `docs/superpowers/pre-release-validation/post-launch-smoke.md`:

```markdown
# Post-Launch Smoke — Apohara Catalyst v1.0.0

Date: TBD
Tester: Pablo
Machine: CachyOS / AMD Ryzen 5 3600 / 16GB

## Install

```bash
$ npm install -g @apohara/catalyst
+ @apohara/catalyst@1.0.0
```

Result: PASS / FAIL

## Doctor output

(paste full apohara doctor output here)

Result: PASS / FAIL
```

- [ ] **Commit**:

```bash
git add docs/superpowers/pre-release-validation/post-launch-smoke.md
git commit -m "docs(release): post-launch smoke test results (G11.C.3)"
git push origin main
```

---

## G11.D — Announce (3 steps)

**Outcome**: Mundo enterado. Opcional: Pablo decide alcance.

### Step G11.D.1: GitHub Discussion (recommended baseline)

- [ ] **Crear Discussion en `SuarezPM/apohara` repo**:

```bash
gh api graphql -f query='
mutation {
  createDiscussion(input: {
    repositoryId: "REPO_ID_HERE",
    categoryId: "CAT_ID_HERE",
    title: "Apohara Catalyst v1.0.0 is live",
    body: "First public release of Apohara Catalyst..."
  }) { discussion { url } }
}'
```

(IDs se obtienen previamente con `gh api graphql` query — escribir manualmente)

### Step G11.D.2: Social copy draft (Pablo decide si publica)

- [ ] **Crear `docs/superpowers/launch/social-copy.md`** con plantillas:

```markdown
# Social copy templates — v1.0.0

## Twitter/X (280 char)

🚀 Apohara Catalyst v1.0.0 is live.

Local-first multi-AI orchestrator that catalyzes parallel dispatch across
Claude Code, Codex, and OpenCode — slashing TTFT without consuming extra
tokens from your subscriptions.

npm install -g @apohara/catalyst

https://github.com/SuarezPM/apohara

## Mastodon / Bluesky (500 char)

Just shipped Apohara Catalyst v1.0.0 🪨🎯

A local-first orchestrator that dispatches in parallel to your AI coding CLIs.
- 3 providers: Claude Code, Codex, OpenCode
- Git worktree isolation per agent
- SQLite for all state, zero cloud
- Tauri 2 desktop + Ink TUI + npx CLI

npm install -g @apohara/catalyst
https://github.com/SuarezPM/apohara

#opensource #localfirst #ai

## Discord/Slack short

Hey, just released Apohara Catalyst v1.0.0 — a local-first orchestrator that
parallelizes across your AI coding CLIs (Claude/Codex/OpenCode). MIT licensed,
no cloud, no OAuth. Curious what you think.

https://github.com/SuarezPM/apohara

## LinkedIn (longer-form)

Today I'm releasing Apohara Catalyst v1.0.0, the result of ~4 months of work
on local-first AI orchestration.

The pitch is simple: you already pay subscriptions to Claude Code, OpenAI Codex,
and OpenCode. Apohara doesn't ask for OAuth or API keys — it shells out to the
CLIs you've already logged into and dispatches tasks across them in parallel.
TTFT (Time-To-First-Token) drops dramatically without consuming a single extra
token from your plans.

Built on Tauri 2 + React 19 + Rust workspace + bun:sqlite. MIT licensed.

Try it: `npm install -g @apohara/catalyst`
GitHub: https://github.com/SuarezPM/apohara
```

- [ ] **Commit**:

```bash
git add docs/superpowers/launch/social-copy.md
git commit -m "docs(launch): social copy templates v1.0.0 (G11.D.2)"
git push origin main
```

### Step G11.D.3: Ecosystem cross-link

- [ ] **Actualizar README de Probant y Consilium si Pablo aprueba**:

En `ecosystem/probant/README.md` y `ecosystem/consilium/README.md`, agregar sección:

```markdown
## Apohara Family

- **Apohara Catalyst** (orchestrator) — https://github.com/SuarezPM/apohara
- **Apohara Probant** (verifier) — this repo
- **Apohara Consilium** (governance) — https://github.com/SuarezPM/consilium
```

- [ ] **Commit en cada repo separadamente** (requiere navegar a esos directorios, abrir PR para cada uno, esperar approve, merge).

---

## Cierre Sprint 11

- [ ] **Verify 1: npm package live**

```bash
npm view @apohara/catalyst@1.0.0 dist.tarball
curl -sI $(npm view @apohara/catalyst@1.0.0 dist.tarball) | head -1
# Expected: HTTP/2 200
```

- [ ] **Verify 2: GitHub Release publicado**

```bash
gh release view v1.0.0 --json url --jq .url
# Esperado: https://github.com/SuarezPM/apohara/releases/tag/v1.0.0
```

- [ ] **Verify 3: Smoke install limpia**

```bash
docker run --rm node:20 npm install -g @apohara/catalyst && echo OK
```

- [ ] **Verify 4: Cerrar el sprint con commit final**

```bash
git checkout main
git log --oneline | head -20
# Should show: release v1.0.0 squash-merge + post-launch badges + smoke results + social copy
```

- [ ] **Verify 5: Archivar plan + reports en una carpeta release**

```bash
mkdir -p docs/releases/v1.0.0
git mv docs/superpowers/pre-release-validation docs/releases/v1.0.0/pre-release-validation
git mv docs/superpowers/launch docs/releases/v1.0.0/launch
git commit -m "docs(release): archive v1.0.0 pre-release + launch artifacts (G11.cierre)"
git push origin main
```

---

## Self-Review

**Spec coverage**:
- spec §5 launch pre-flight: G11.A.1-A.4.
- spec §5 publish (npm + GitHub Release + tag): G11.B.1-B.4.
- spec §5 post-launch verify: G11.C.1-C.3.
- spec §5 announcement: G11.D.1-D.3.

**Placeholder scan**: Los TBD en `post-launch-smoke.md` y `sign-off.md` son intencionales — son formularios que se rellenan en launch day.

**Riesgos identificados y mitigados**:
- Pablo no aprueba push tag → ESTOP documentado en G11.B.2.
- npm publish falla por scope no claimado → revisar `npm whoami` + scope ownership en step G11.B.3 antes de publish.
- GitHub branch protection bloquea merge directo a main → G11.B.1 usa PR + auto-merge en lugar de push directo.
- Si Pablo no quiere publicar en social → G11.D.2 es opcional, los templates quedan en repo como referencia.

**Esfuerzo total**: ~1.5-2 días — un solo implementer secuencial. NO paralelizable por orden de dependencias (no se publica antes de sign-off, no se anuncia antes de publish, etc.).

**Out-of-scope explícito**:
- Demo video (excluded por Pablo en brainstorming).
- Comparative benchmarks vs orca/vibe-kanban (excluded por Pablo en brainstorming).
- Tauri .app/.dmg/.msi distribución: optional en G11.B.4, se decide al ejecutar.
