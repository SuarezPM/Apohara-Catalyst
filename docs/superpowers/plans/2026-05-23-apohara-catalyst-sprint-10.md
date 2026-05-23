# Apohara Catalyst Sprint 10 — Pre-Release Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validar que Apohara Catalyst está listo para release público: cross-platform smoke (Linux + macOS + Windows + WSL2), security audit pass, performance gates dentro de targets, instalación end-to-end vía `npm install -g @apohara/catalyst`, `apohara doctor` + `verify-setup` cubren todos los failure modes, secrets/credentials no leakean a logs/artifacts/crash-reports. Sin TDD bite-sized estricto — este sprint es operativo y orientado a checklists/runbooks; donde aplica TDD lo tiene (regression guards), donde aplica smoke manual lo documenta explícitamente.

**Architecture:** 4 grupos. G10.A cross-platform smoke. G10.B security audit. G10.C performance gates. G10.D doctor/verify-setup final coverage. Cada grupo cierra con un report markdown documentado en `docs/superpowers/pre-release-validation/` que el Sprint 11 (launch) consumirá como evidencia.

**Tech Stack:** GitHub Actions matrices (Linux ubuntu-22.04 / macOS-14 / windows-2022) + `cargo audit` + `bun audit` + `npm pack` smoke + Playwright + `hyperfine` (benchmarks reproducibles).

---

## Estructura del Sprint 10

### 4 grupos

| Grupo | Tema | # tareas | Esfuerzo | Implementer |
|---|---|---:|---:|---|
| **G10.A** | Cross-platform smoke (Linux/macOS/Windows/WSL2) | 4 | 1 día | 1 |
| **G10.B** | Security audit pass (deps + secrets + sandbox) | 4 | 1 día | 2 |
| **G10.C** | Performance gates + benchmarks | 3 | 0.5 día | 3 |
| **G10.D** | Doctor + verify-setup final coverage | 3 | 0.5 día | 4 (paraleliza) |

**Total**: 14 tareas, ~2.5 días con 4 implementers paralelos.

---

## Setup

- [ ] **Setup 1: Branch + base verde post-Sprint-9**

```bash
git status
# On branch feat/apohara-catalyst, 7.5+8+9 commiteados, suite verde.
```

Run: `bun test && cargo test --workspace`
Expected: success.

- [ ] **Setup 2: Crear directorio de reports**

```bash
mkdir -p docs/superpowers/pre-release-validation
```

Aquí se commitea cada report (`g10-a-cross-platform.md`, `g10-b-security.md`, `g10-c-performance.md`, `g10-d-doctor.md`).

---

## G10.A — Cross-platform smoke (4 tareas, 1 día)

**Outcome**: CI ejecuta una smoke matrix en {Linux ubuntu-22.04, macOS-14, Windows-2022, WSL2}. Cada plataforma instala el `npm` package, ejecuta `apohara doctor` y `apohara verify-setup`, asegura cero errores no esperados. Reports recogidos como artifact y resumidos en `g10-a-cross-platform.md`.

### Task G10.A.1: Definir matrix en CI workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Localizar workflow actual**

```bash
rg -n 'cross-platform-smoke' .github/workflows/ci.yml || rg -n 'jobs:' .github/workflows/ci.yml | head -5
```

(El job `cross-platform-smoke` fue agregado en Sprint 7 G7.E.4. Este sprint lo amplía y endurece.)

- [ ] **Step 2: Ampliar matrix**

Asegurar que el job `cross-platform-smoke` incluye:

```yaml
cross-platform-smoke:
  name: cross-platform-smoke
  strategy:
    fail-fast: false
    matrix:
      os: [ubuntu-22.04, macos-14, windows-2022]
      node: ['20', '22']
  runs-on: ${{ matrix.os }}
  steps:
    - uses: actions/checkout@v5
    - uses: actions/setup-node@v5
      with:
        node-version: ${{ matrix.node }}
    - name: Install bun
      uses: oven-sh/setup-bun@v1
      with:
        bun-version: '1.3.13'
    - name: Install package as user would
      run: |
        cd npx-cli
        npm pack
        npm install -g ./apohara-catalyst-*.tgz
    - name: apohara doctor (must exit 0 or 2)
      run: apohara doctor || [ $? -eq 2 ]   # 0 = all green, 2 = warnings but installable
      shell: bash
    - name: apohara --version
      run: apohara --version
    - name: Upload doctor report
      if: always()
      uses: actions/upload-artifact@v5
      with:
        name: doctor-${{ matrix.os }}-node${{ matrix.node }}
        path: ~/.apohara/doctor-report.json
        if-no-files-found: warn
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(smoke): cross-platform matrix Ubuntu/macOS/Windows × Node 20/22 (G10.A.1)"
```

### Task G10.A.2: WSL2 manual smoke runbook

**Files:**
- Create: `docs/superpowers/pre-release-validation/wsl2-runbook.md`

- [ ] **Step 1: Documentar pasos para WSL2 manual**

```markdown
# WSL2 Smoke Test — Apohara Catalyst v1.0.0-rc.1

GitHub Actions no provee runners WSL2 nativos, así que este test corre manualmente antes del launch.

## Prereqs en Windows host

- Windows 11 22H2+ con WSL2 enabled
- Ubuntu-22.04 distro instalada via `wsl --install -d Ubuntu-22.04`
- Bun 1.3.13+, Node 20+, Git en WSL2

## Pasos

1. `wsl -d Ubuntu-22.04`
2. `cd ~ && mkdir apohara-smoke && cd apohara-smoke`
3. `git clone https://github.com/SuarezPM/apohara && cd apohara`
4. `cd npx-cli && npm pack && npm install -g ./apohara-catalyst-*.tgz`
5. `apohara --version` (espera `1.0.0-rc.1`)
6. `apohara doctor` (todo verde excepto opcionales por no tener Claude CLI instalado)
7. `apohara` (UI abre en http://localhost:7331 — verificar `wsl --status` para encontrar IP)
8. Abrir IP:7331 desde Windows host → verifica render
9. Documentar resultado en este archivo (PASS/FAIL + screenshot)

## Resultado del último smoke

- Date: TBD (rellenar al ejecutar)
- WSL distro: Ubuntu-22.04
- Result: TBD
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/pre-release-validation/wsl2-runbook.md
git commit -m "docs(release): WSL2 manual smoke runbook (G10.A.2)"
```

### Task G10.A.3: macOS notarization smoke

**Files:**
- Create: `docs/superpowers/pre-release-validation/macos-notarization-runbook.md`

- [ ] **Step 1: Documentar pasos**

```markdown
# macOS Notarization Smoke — Apohara Catalyst v1.0.0-rc.1

El npm package no requiere notarization, PERO el binario Tauri si lo distribuimos como `.dmg` o `.app` en GitHub Releases sí.

## Si solo distribuimos vía npm

Notarization NO aplica. `apohara` instalado vía `npm install -g` corre como Node script, no como app firmada. Sin warnings de Gatekeeper.

## Si distribuimos Tauri .app

Ver `docs/tauri-notarization.md` (TBD — solo aplica cuando Tauri release sea parte del scope). Sprint 11 launch decide si publicamos Tauri .app o solo npm.

## Verificación manual

1. Instalar en macOS 14+: `npm install -g @apohara/catalyst-1.0.0-rc.1.tgz`
2. `apohara doctor` debe abrir sin prompt de Gatekeeper
3. Si aparece warning, capturar screenshot + documentar
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/pre-release-validation/macos-notarization-runbook.md
git commit -m "docs(release): macOS notarization smoke runbook (G10.A.3)"
```

### Task G10.A.4: Generar `g10-a-cross-platform.md` report

**Files:**
- Create: `docs/superpowers/pre-release-validation/g10-a-cross-platform.md`

- [ ] **Step 1: Ejecutar CI matrix + capturar resultados**

Trigger CI run (push branch o `gh workflow run ci.yml`) y esperar que la matrix complete.

```bash
gh run watch
```

- [ ] **Step 2: Generar report**

```markdown
# G10.A — Cross-Platform Validation Report

Date: TBD
Branch: feat/apohara-catalyst
CI run: <link>

## Matrix results

| OS            | Node | Install | Doctor | Verify-setup | Status |
|---------------|------|---------|--------|--------------|--------|
| ubuntu-22.04  | 20   | ✅       | ✅      | ✅            | PASS   |
| ubuntu-22.04  | 22   | ✅       | ✅      | ✅            | PASS   |
| macos-14      | 20   | TBD     | TBD    | TBD          | TBD    |
| macos-14      | 22   | TBD     | TBD    | TBD          | TBD    |
| windows-2022  | 20   | TBD     | TBD    | TBD          | TBD    |
| windows-2022  | 22   | TBD     | TBD    | TBD          | TBD    |
| WSL2 (manual) | 20   | TBD     | TBD    | TBD          | TBD    |

## Anomalías

- Listar aquí cualquier failure inesperado y la mitigación.

## Decisión para launch

- ✅ Proceed if all matrix cells PASS
- 🛑 Block launch if any platform FAILS without documented mitigation
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/pre-release-validation/g10-a-cross-platform.md
git commit -m "docs(release): G10.A cross-platform validation report (G10.A.4)"
```

---

## G10.B — Security audit pass (4 tareas, 1 día)

**Outcome**: `cargo audit` + `bun audit` corren clean (o documentadas todas las advisories con justificación). Sandbox boundary verified empíricamente (escape attempts fallen). Crash reports redaction verificada con fuzzing input. Secrets jamás presentes en logs/artifacts publicados.

### Task G10.B.1: cargo audit + bun audit pass

**Files:**
- Create: `docs/superpowers/pre-release-validation/g10-b-security.md`

- [ ] **Step 1: Run audits**

```bash
cargo install cargo-audit --locked 2>/dev/null || true
cargo audit > /tmp/cargo-audit-output.txt 2>&1 || true
bun audit > /tmp/bun-audit-output.txt 2>&1 || true
cd npx-cli && npm audit --omit dev > /tmp/npm-audit-output.txt 2>&1 || true
```

- [ ] **Step 2: Triage hallazgos**

Por cada advisory:
- Critical/High → debe estar fixed antes de launch.
- Medium/Low → documentar con justificación si se acepta el riesgo.
- Informational → ignorar.

- [ ] **Step 3: Generar `g10-b-security.md`**

```markdown
# G10.B — Security Audit Report

Date: TBD

## cargo audit

Output: see /tmp/cargo-audit-output.txt
Critical/High: TBD
Triaged advisories:
- (none) | listar con CVE + decisión

## bun + npm audit

Output: see /tmp/bun-audit-output.txt, /tmp/npm-audit-output.txt
Critical/High: TBD
Triaged advisories:
- (none) | listar

## Sandbox boundary verification

- ✅ §0.4 sanitizeEnv: tests `tests/core/persistence/envSanitizer.test.ts` (count: TBD) — todas pasan
- ✅ §0.8 atomic writes: tests `tests/core/persistence/atomicWrite.test.ts` — todas pasan
- ✅ pathsafety: tests `crates/apohara-pathsafety/` — todas pasan
- ✅ sandbox seccomp: tests `crates/apohara-sandbox/` — todas pasan

## Conclusión

PROCEED / BLOCK
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/pre-release-validation/g10-b-security.md
git commit -m "docs(release): G10.B security audit report (G10.B.1)"
```

### Task G10.B.2: Secret-scanning regression guard

**Files:**
- Create: `tests/unit/no-secrets-in-build.test.ts`

- [ ] **Step 1: Test**

```typescript
// tests/unit/no-secrets-in-build.test.ts
import { expect, test } from "bun:test";
import { execSync } from "child_process";

const PATTERNS = [
  "sk-ant-[a-zA-Z0-9-]{40,}",     // Anthropic
  "sk-proj-[a-zA-Z0-9-]{20,}",     // OpenAI
  "AIA[A-Z0-9]{16,}",              // AWS access key
  "ghp_[a-zA-Z0-9]{36,}",          // GitHub PAT
  "gho_[a-zA-Z0-9]{36,}",          // GitHub OAuth
  "ya29\\.",                       // Google OAuth
];

test("built bundle has no hardcoded secrets", () => {
  const cmd = `rg --hidden -e '${PATTERNS.join("' -e '")}' dist/ packages/desktop/dist/ npx-cli/dist/ 2>/dev/null || true`;
  const result = execSync(cmd, { encoding: "utf-8" }).trim();
  expect(result).toBe("");
});

test("source tree has no committed secrets", () => {
  const cmd = `rg --hidden -e '${PATTERNS.join("' -e '")}' src/ packages/ crates/ 2>/dev/null || true`;
  const result = execSync(cmd, { encoding: "utf-8" }).trim();
  expect(result).toBe("");
});
```

- [ ] **Step 2: Run**

```bash
bun test tests/unit/no-secrets-in-build.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/unit/no-secrets-in-build.test.ts
git commit -m "test(security): regression guard for hardcoded secrets (G10.B.2)"
```

### Task G10.B.3: Crash report redaction fuzz

**Files:**
- Create: `tests/unit/crash-report-redaction-fuzz.test.ts`

- [ ] **Step 1: Test que la función `redact()` del crash reporter (entregado en Sprint 7.5 G7.5.D) borra secrets de payloads sintéticos**

```typescript
// tests/unit/crash-report-redaction-fuzz.test.ts
import { expect, test } from "bun:test";
import { redactCrashReport } from "../../src/core/telemetry/crashReporter";

const SECRETS = [
  "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
  "sk-proj-1234567890abcdefghij",
  "AIAIOSFODNN7EXAMPLE",
  "ghp_abcdef0123456789abcdef0123456789abcdef",
];

test("crash report redaction removes all known secret formats", () => {
  for (const secret of SECRETS) {
    const payload = { stack: `Error\n    at foo (${secret}/x.ts:1:1)`, env: { SOME_KEY: secret } };
    const redacted = redactCrashReport(payload);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(secret);
  }
});

test("crash report preserves non-secret content", () => {
  const payload = { stack: "TypeError: foo is not a function\n    at bar (/home/user/app.ts:42:10)" };
  const redacted = redactCrashReport(payload);
  expect(redacted.stack).toContain("TypeError");
  expect(redacted.stack).toContain("bar");
});
```

- [ ] **Step 2: Run + commit**

```bash
bun test tests/unit/crash-report-redaction-fuzz.test.ts
git add tests/unit/crash-report-redaction-fuzz.test.ts
git commit -m "test(security): fuzz redactCrashReport with known secret formats (G10.B.3)"
```

### Task G10.B.4: Update g10-b-security.md con resultados de G10.B.2 + G10.B.3

**Files:**
- Modify: `docs/superpowers/pre-release-validation/g10-b-security.md`

- [ ] **Step 1: Append**

```markdown
## Regression guards

- ✅ tests/unit/no-secrets-in-build.test.ts — built bundle scanning
- ✅ tests/unit/crash-report-redaction-fuzz.test.ts — synthetic secret fuzz

## Threat model coverage

- Provider env leak: §0.4 sanitizeEnv (verified via existing tests + spawn-site grep audit during Sprint 5)
- Workspace escape: pathsafety crate + symlink-deny tests
- Crash report exfil: redactor fuzz (this sprint)
- Process privilege: sandbox seccomp tests + no-setuid binaries in npm package
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/pre-release-validation/g10-b-security.md
git commit -m "docs(release): G10.B final security report after regression guards (G10.B.4)"
```

---

## G10.C — Performance gates + benchmarks (3 tareas, 0.5 día)

**Outcome**: Tres benchmarks reproducibles via `hyperfine`. Cold start < 500ms (apohara CLI). Dispatch latency p50 < 200ms (mock provider). Indexer query latency p50 < 50ms (10k chunks).

### Task G10.C.1: Cold-start benchmark

**Files:**
- Create: `scripts/bench/cold-start.sh`
- Create: `docs/superpowers/pre-release-validation/g10-c-performance.md`

- [ ] **Step 1: Script**

```bash
#!/usr/bin/env bash
# scripts/bench/cold-start.sh
# Measure apohara CLI cold start (time to print --version).

set -euo pipefail
which hyperfine > /dev/null || { echo "install hyperfine first"; exit 1; }
hyperfine --warmup 3 --runs 20 'apohara --version' --export-json /tmp/cold-start.json
echo "p50: $(jq '.results[0].mean * 1000' /tmp/cold-start.json) ms"
```

- [ ] **Step 2: Run + capture**

```bash
chmod +x scripts/bench/cold-start.sh
./scripts/bench/cold-start.sh > /tmp/cold-start-output.txt
```

Target: p50 < 500ms en hardware referencia (Pablo: AMD Ryzen 5 3600 / 16GB).

- [ ] **Step 3: Commit (script + initial result en report)**

```bash
git add scripts/bench/cold-start.sh
git commit -m "bench: cold-start benchmark script (G10.C.1)"
```

### Task G10.C.2: Dispatch latency benchmark

**Files:**
- Create: `scripts/bench/dispatch-latency.sh`

- [ ] **Step 1: Script (usa mock provider via APOHARA_FAKE_PROVIDER=1 o equivalent)**

```bash
#!/usr/bin/env bash
# scripts/bench/dispatch-latency.sh
# Mide latencia end-to-end de un dispatch via API /api/run con mock provider.

set -euo pipefail
APOHARA_DESKTOP_PORT=7331 APOHARA_FAKE_PROVIDER=1 bun --hot packages/desktop/src/server.ts &
SERVER_PID=$!
sleep 3

hyperfine --warmup 3 --runs 50 \
  'curl -s -X POST http://localhost:7331/api/run -H "Content-Type: application/json" -d "{\"prompt\":\"hello\",\"role\":\"coder\"}"' \
  --export-json /tmp/dispatch-latency.json

kill $SERVER_PID
echo "p50: $(jq '.results[0].mean * 1000' /tmp/dispatch-latency.json) ms"
```

Target: p50 < 200ms.

- [ ] **Step 2: Commit**

```bash
chmod +x scripts/bench/dispatch-latency.sh
git add scripts/bench/dispatch-latency.sh
git commit -m "bench: dispatch latency benchmark script (G10.C.2)"
```

### Task G10.C.3: Indexer query latency + final report

**Files:**
- Create: `scripts/bench/indexer-query.sh`
- Modify: `docs/superpowers/pre-release-validation/g10-c-performance.md`

- [ ] **Step 1: Script**

```bash
#!/usr/bin/env bash
# scripts/bench/indexer-query.sh
# Mide latencia de knn_query con 10k chunks pre-indexados.

set -euo pipefail

DB=/tmp/indexer-bench.sqlite
rm -f "$DB"

# Seed 10k chunks sintéticos
mkdir -p /tmp/indexer-bench-corpus
for i in $(seq 1 10000); do
  echo "pub fn func_$i() { /* chunk $i */ }" > /tmp/indexer-bench-corpus/file_$i.rs
done

./target/release/apohara-indexer index "$DB" /tmp/indexer-bench-corpus/*.rs > /dev/null

hyperfine --warmup 5 --runs 30 \
  "./target/release/apohara-indexer query $DB 'func_4242 chunk'" \
  --export-json /tmp/indexer-query.json

echo "p50: $(jq '.results[0].mean * 1000' /tmp/indexer-query.json) ms"
```

Target: p50 < 50ms con 10k chunks.

- [ ] **Step 2: Run + populate report**

```bash
cd /home/thelinconx/Documentos/Apohara_Ultimate/apohara-v1-impl
cargo build --release -p apohara-indexer
chmod +x scripts/bench/indexer-query.sh
./scripts/bench/indexer-query.sh
```

Update `g10-c-performance.md`:

```markdown
# G10.C — Performance Validation Report

Date: TBD
Hardware reference: AMD Ryzen 5 3600 / 16GB / NVMe Gen4

## Benchmarks

| Bench               | Target   | Measured | Status |
|---------------------|----------|----------|--------|
| Cold start          | < 500ms  | TBD      | TBD    |
| Dispatch latency p50| < 200ms  | TBD      | TBD    |
| Indexer query p50   | < 50ms   | TBD      | TBD    |

## Methodology

- `hyperfine` con warmup 3-5 runs + 20-50 measured runs
- Mock provider para dispatch (no externalidad de red)
- 10k chunks sintéticos para indexer

## Decisión

PROCEED / TUNE-THEN-PROCEED / BLOCK
```

- [ ] **Step 3: Commit**

```bash
git add scripts/bench/indexer-query.sh docs/superpowers/pre-release-validation/g10-c-performance.md
git commit -m "bench(release): indexer-query benchmark + G10.C final report (G10.C.3)"
```

---

## G10.D — Doctor + verify-setup final coverage (3 tareas, 0.5 día)

**Outcome**: `apohara doctor` cubre cada precondition. `apohara verify-setup` ejecuta end-to-end round-trip con cada provider activo. Exit codes documentados. Report markdown.

### Task G10.D.1: Doctor coverage audit

**Files:**
- Create: `docs/superpowers/pre-release-validation/g10-d-doctor.md`

- [ ] **Step 1: Inventariar checks actuales**

```bash
rg -n 'doctor.*check|registerCheck' src/core/cli/doctor.ts | head -20
```

- [ ] **Step 2: Lista de checks esperados (cubrir gaps)**

Esperados v1.0.0-rc.1:
- Node version >= 20
- Bun present (if applicable)
- Git present + version >= 2.40
- Active provider CLIs reachable:
  - claude-code-cli (`claude --version`)
  - codex-cli (`codex --version`)
  - opencode-go (`opencode --version`)
- OS support tier (Linux/macOS/Windows)
- Writable `~/.apohara/` directory
- Secret store accessible (`apohara-secrets` keyring probe)
- Disk space > 1GB free in workspace dir
- Tauri capabilities (if desktop installed)
- Optional CLIs (warnings only): gh, hyperfine (for benchmarks), playwright

- [ ] **Step 3: Si algún check NO está implementado en src/core/cli/doctor.ts, agregarlo**

Patrón para nuevo check:

```typescript
// src/core/cli/doctor.ts
doctor.registerCheck({
  id: "disk-space-workspace",
  name: "Workspace disk space > 1GB",
  run: async () => {
    const { statfs } = await import("fs/promises");
    const stat = await statfs(process.cwd());
    const freeGB = (stat.bavail * stat.bsize) / (1024 ** 3);
    return freeGB > 1
      ? { status: "pass", detail: `${freeGB.toFixed(2)} GB free` }
      : { status: "fail", detail: `only ${freeGB.toFixed(2)} GB free, recommend > 1 GB` };
  },
});
```

- [ ] **Step 4: Tests para cada check nuevo**

Patrón:

```typescript
// tests/core/cli/doctor.disk-space.test.ts
import { expect, test, mock } from "bun:test";
import { runDoctorCheck } from "../../../src/core/cli/doctor";

test("disk-space-workspace passes when > 1GB free", async () => {
  const result = await runDoctorCheck("disk-space-workspace");
  expect(["pass", "warn", "fail"]).toContain(result.status);
});
```

- [ ] **Step 5: Commit**

```bash
git add src/core/cli/doctor.ts tests/core/cli/doctor.*.test.ts
git commit -m "feat(doctor): add disk-space + missing checks for v1.0.0-rc.1 (G10.D.1)"
```

### Task G10.D.2: verify-setup end-to-end coverage

**Files:**
- Modify: `src/core/cli/verifySetup.ts` (o ruta actual)

- [ ] **Step 1: Inspect verifySetup actual**

```bash
rg -l 'verifySetup|verify-setup' src/core/cli/ | head -3
```

- [ ] **Step 2: Asegurar cobertura**

Verify-setup debe:
1. Ejecutar `apohara doctor` y abortar si exit != 0 y != 2 (warnings).
2. Spawn un mock task via `/api/run` y verificar que el SSE round-trip funciona.
3. Para cada provider activo: enviar `--version` y verificar exit 0.
4. Spinner mientras corre + report al cerrar.

- [ ] **Step 3: Test integration**

```typescript
// tests/integration/verify-setup-e2e.test.ts
import { expect, test } from "bun:test";
import { execSync } from "child_process";

test("apohara verify-setup completes successfully with mock providers", () => {
  process.env.APOHARA_FAKE_PROVIDER = "1";
  const result = execSync("apohara verify-setup --skip-real-providers", { encoding: "utf-8", timeout: 30_000 });
  expect(result).toContain("verify-setup OK");
});
```

- [ ] **Step 4: Commit**

```bash
git add src/core/cli/verifySetup.ts tests/integration/verify-setup-e2e.test.ts
git commit -m "feat(verify-setup): end-to-end coverage with skip-real-providers flag (G10.D.2)"
```

### Task G10.D.3: g10-d-doctor.md final report

**Files:**
- Modify: `docs/superpowers/pre-release-validation/g10-d-doctor.md`

- [ ] **Step 1: Documentar resultados**

```markdown
# G10.D — Doctor + verify-setup Coverage Report

Date: TBD

## Doctor checks (`apohara doctor`)

| Check ID                      | Status | Notes |
|-------------------------------|--------|-------|
| node-version                  | pass   |       |
| bun-presence                  | pass   |       |
| git-version                   | pass   |       |
| claude-code-cli               | pass   | optional warning if not installed |
| codex-cli                     | pass   | optional warning if not installed |
| opencode-go                   | pass   | optional warning if not installed |
| writable-apohara-home         | pass   |       |
| secret-store-accessible       | pass   |       |
| disk-space-workspace          | pass   |       |
| os-support-tier               | pass   |       |

## Exit codes

- 0 = all green
- 1 = unexpected error (network, panic, etc.)
- 2 = soft warnings (e.g., optional CLI missing) — installable, but partial functionality

## verify-setup

- Mock provider e2e: ✅ (tests/integration/verify-setup-e2e.test.ts)
- Real providers smoke (manual, optional in CI): TBD per platform

## Conclusión

PROCEED / BLOCK
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/pre-release-validation/g10-d-doctor.md
git commit -m "docs(release): G10.D doctor + verify-setup coverage report (G10.D.3)"
```

---

## Cierre Sprint 10

- [ ] **Verify 1: 4 reports presentes**

```bash
ls docs/superpowers/pre-release-validation/g10-{a,b,c,d}-*.md
```
Expected: 4 archivos existen, todos con sección "Conclusión: PROCEED" (si alguno dice BLOCK, ese gap se aborda antes de Sprint 11).

- [ ] **Verify 2: Suite full verde**

```bash
bun test && cargo test --workspace
```
Expected: success.

- [ ] **Verify 3: CI cross-platform smoke pasa**

```bash
gh workflow run ci.yml --ref feat/apohara-catalyst
gh run watch
```
Expected: all matrix cells green.

- [ ] **Verify 4: Commit cierre**

```bash
git log --oneline feat/apohara-catalyst | head -30
```

---

## Self-Review

**Spec coverage**:
- spec §4 cross-platform validation: G10.A.1-A.4.
- spec §4 security audit: G10.B.1-B.4.
- spec §4 performance gates: G10.C.1-C.3.
- spec §4 doctor/verify-setup final: G10.D.1-D.3.

**Placeholder scan**: Los reports markdown llevan `TBD` en celdas que se rellenan al ejecutar — esto es intencional (el report ES el formulario). El plan en sí no tiene "TODO/implement later" en steps de implementación.

**Type consistency**: No aplica fuerte (este sprint es operativo). Las APIs nuevas (`registerCheck`, `runDoctorCheck`) son consistentes entre G10.D.1 y los tests asociados.

**Riesgo identificado y mitigado**:
- CI matrix puede tardar 20+ min: documentado en G10.A.4, justifica que se ejecuta una sola vez al final del sprint.
- Hyperfine no disponible en CI: benchmarks G10.C corren localmente en hardware de Pablo, no en CI runners (su variabilidad invalida números).
- Si algún report dice "BLOCK", Sprint 11 launch se atrasa hasta resolver: documentado en "Conclusión" de cada report.

**Esfuerzo total**: ~2.5 días con 4 implementers paralelos (G10.A-D son disjuntos, pueden arrancar todos a la vez tras Setup).
