# Audit: nimbalyst-landing (15 hallazgos)

> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD (`d9372eb`).
> Alcance: posicionamiento, mensajería, copy, UX value props y business-model framing.
> Fuente: `docs/reference-mining/nimbalyst-landing.md` (15 hallazgos F1-F15).
> Anclas evaluadas: `README.md`, `PRINCIPLES.md`, `CHANGELOG.md`, `ROADMAP.md`,
> `npx-cli/README.md`, `scripts/install.sh`, `packaging/homebrew/apohara.rb`,
> `packages/desktop/src/components/*.tsx`, `docs/PROJECT.md`,
> `docs/superpowers/specs/2026-05-21-apohara-v1-design.md` §8.3 +
> `docs/superpowers/plans/2026-05-22-apohara-v1.md` Tasks 11.6/11.7.

## Resumen

| Status | Cantidad |
|---|---:|
| COMPLETO | 4 |
| PARCIAL | 4 |
| NO IMPLEMENTADO | 6 |
| RECHAZADO | 1 |
| AMBIGUO | 0 |
| **Total** | **15** |

Diferencia clave entre **NO IMPLEMENTADO** y **RECHAZADO**: ambos no aparecen en
código/docs, pero RECHAZADO está explícitamente descartado en el sprint plan
(`docs/superpowers/plans/2026-05-22-reference-mining-sprints.md` §"Lo que NO
robamos" + §"Items diferidos a v1.1+"). NO IMPLEMENTADO sigue siendo trabajo
abierto (típicamente content / marketing copy gap).

---

## Hallazgos

### Finding 1: "For builders" tagline + verb-first headline structure

- **Origen landing**: hero homepage — *"The open-source visual workspace for building with Codex, Claude Code, and more"* + tagline *"For builders"*.
- **Apohara actual**: `README.md:3` headline: *"Local-first multi-agent code orchestration on top of CLI providers — no API keys, replayable by design."*
- **Status**: PARCIAL.
- **Evidencia**:
  - Estructura outcome-first SI presente: `README.md:3` lidera con "multi-agent code orchestration" y "no API keys" antes de stack.
  - Tagline "For builders" / "For engineers who ship" NO presente — `grep -i "for builders\|tagline\|for engineers"` en `README.md PRINCIPLES.md CHANGELOG.md` no devuelve nada.
  - Plan §11.6 prescribe explícitamente: *"Hero: 'The verifiable multi-AI orchestrator for builders who don't want to manage API keys' + tagline 'For builders who ship'"* (`docs/superpowers/plans/2026-05-22-apohara-v1.md:10768`). El README rewrite (`4a76302`) shipeó la línea outcome-first pero **sin** la tagline complementaria.
- **Gap**: falta la tagline/declaración de audiencia debajo del headline. La línea actual lidera con stack ("Local-first multi-agent code orchestration") en lugar de outcome+audiencia ("for builders who don't want to manage API keys").
- **Recomendación**: agregar una tagline H2 o párrafo corto debajo del title con el formato "For \<audiencia\> who \<acción\>" — concretamente *"For builders who ship without juggling API keys"* o *"For teams that audit every agent action"*.

---

### Finding 2: Explicit BYOK / "no API keys" framing as a value, not a footnote

- **Origen landing**: `/pricing/` "Bring-your-own API keys; LM Studio support"; `/about/` principle #4 "No lock-in, no surprise cloud dependencies".
- **Apohara actual**: `README.md:7-9` + `PRINCIPLES.md:5-9` (Principle 1: "Your credentials, your machine").
- **Status**: COMPLETO.
- **Evidencia**:
  - `README.md:3`: *"no API keys"* en el headline.
  - `README.md:7`: *"Your subscriptions stay with you. Apohara does not hold provider API keys, broker an OAuth flow, or store tokens in a cloud vault."*
  - `PRINCIPLES.md:5-9` Principio #1: *"Apohara never holds your provider API keys. The three CLI drivers (`claude-code-cli`, `codex-cli`, `opencode-go`) authenticate against your existing subscriptions over stdio. No OAuth flow, no cloud-side token vault, no 'improved' key management we'd later have to defend."*
  - `CHANGELOG.md:35`: *"No provider OAuth, no provider API keys — credentials never enter the orchestrator process; CLI wrappers communicate over stdio with sanitized env."*
  - El differential vs nimbalyst (zero keys vs BYOK paste) está enfatizado: README y PRINCIPLES dejan claro que Apohara no pide ni siquiera pasta de API key.
- **Recomendación**: ninguna; el posicionamiento es claro y consistente entre los tres docs.

---

### Finding 3: Six-principle manifesto ("What Drives Us")

- **Origen landing**: `/about/` 6 principios numerados (Visual-first, Agent management for everyone, Shared context, User ownership, Inline collaboration, Extensibility).
- **Apohara actual**: `PRINCIPLES.md` (40 LOC, 6 principios numerados).
- **Status**: COMPLETO.
- **Evidencia**:
  - `PRINCIPLES.md` existe en la raíz, con 6 principios:
    1. *"Your credentials, your machine"* (`:5-9`)
    2. *"Replay or it didn't happen"* (`:11-13`)
    3. *"The judge / critic / invariants gate (INV-15) is not optional"* (`:15-22`)
    4. *"The blast radius of any agent is finite"* (`:24-32`)
    5. *"Three providers. No more, no fewer."* (`:34-36`)
    6. *"Local-first, not local-only"* (`:38-42`)
  - Referenciado desde `README.md:11` y `:82`.
  - Plan §11.7 prescribió 6 principios distintos ("Verifiability over vibes", "Locks over hopes", "Audit over trust", "Local-first over cloud", "Wrappers over keys", "Formal over folklore") en `docs/superpowers/plans/2026-05-22-apohara-v1.md:10793-10809`. El shipped (`f03416a`) renombró pero el spirit + count = 6 está intacto.
- **Recomendación**: ninguna estructural. Opcionalmente añadir alias labels (e.g. "Locks over hopes" como subtítulo del principio 4) para mejorar memorabilidad en talks/blog posts.

---

### Finding 4: Enterprise logo wall as social proof early

- **Origen landing**: above-the-fold logo wall (Automattic, Redfin, Vanta, Gainsight, Zillow, UKG, SAP, Yahoo, Delivery Hero, Noom).
- **Apohara actual**: ninguna sección "Used by" / "Adopted by" / placeholder.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**:
  - `grep -ni "used by\|adopted by\|customers\|logo wall\|early adopter"` en `README.md PRINCIPLES.md CHANGELOG.md ROADMAP.md` — sin resultados.
  - El finding mismo aclara que el logo wall es **prematuro** para v1.0 (cero deployed users), pero recomienda reservar el slot + reemplazar con GitHub stars/contributors/"early adopter Discord access" call.
  - El slot tampoco está comentado (no hay `<!-- TODO: Used by -->` reservado).
- **Recomendación**: añadir sección "Used by" oculta (HTML comment) o sección "Join the early-adopter program" linkeando al Discord (cuando exista). Plan §11.6 menciona "Discord" en footer (`:10791`) pero el README shipped no lo hace.

---

### Finding 5: Six named testimonials with first names + last initials

- **Origen landing**: 6 testimonios mid-page con fotos + nombres reales (e.g., "Satya Gunnam: Nimbalyst blew my mind from day one").
- **Apohara actual**: ninguna sección de testimonios.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**:
  - `grep -ni "testimonial\|quote\|review\|user.says"` en docs user-facing — sin resultados.
  - El finding mismo lo posiciona como trabajo de RC beta (1 semana, ~5 quotes). No es trabajo de v1.0 código.
- **Recomendación**: durante la beta v1.0 RC, recolectar 3-5 quotes de beta testers + agregar sección comentada en README. Para v1.0 launch, dejarla escondida (HTML comment); poblarla en v1.0.1+.

---

### Finding 6: SOC 2 Type 2 footer badge as trust signal

- **Origen landing**: footer "SOC 2 Type 2 certified" + `/features/` "Open & Secure" section.
- **Apohara actual**: INV-15 mencionado como texto en README/PRINCIPLES; **sin badges visuales** (shields.io u otros).
- **Status**: PARCIAL.
- **Evidencia**:
  - `README.md:11`: *"The judge / critic / invariants gate is not optional ... INV-15 is the gate"*.
  - `PRINCIPLES.md:15-22` Principio #3 menciona INV-15 explícitamente.
  - `CHANGELOG.md:27`: *"INV-15 JCR Safety Gate — judge + critic + invariants must all pass before any PR ships."*
  - `ROADMAP.md:81`: *"Apohara Context Forge ... INV-15 safety invariant. Published paper: DOI 10.5281/zenodo.20114594."*
  - **NO** existe badge tipo `[INV-15 ✓ Z3-verified bounded-staleness]` o `[SHA-256 ledger ✓ replay-verifiable]` (prescripto en `docs/superpowers/plans/2026-05-22-apohara-v1.md:10776`).
  - **NO** existe link al paper Z3 / DOI 10.5281/zenodo.20114594 desde el `README.md` o `PRINCIPLES.md` (sólo en ROADMAP.md `:35`).
  - `grep -i "z3"` devuelve ningún resultado en README/PRINCIPLES/CHANGELOG user-facing.
- **Gap**: el formal-proof / Z3 / DOI no está expuesto al lector casual del README. INV-15 se menciona pero sin la calificación "Z3-verified" que lo distingue de soft policy gates.
- **Recomendación**: añadir 2 badges en el top del README:
  - `![INV-15 Z3-verified](https://img.shields.io/badge/INV--15-Z3--verified-blue)` linkeando al DOI 10.5281/zenodo.20114594.
  - `![SHA-256 ledger replay-verifiable](https://img.shields.io/badge/ledger-SHA--256%20replay%E2%9C%93-green)`.
  - Linkear DOI desde `PRINCIPLES.md` Principio #3.

---

### Finding 7: Single CTA dominance: Download by platform

- **Origen landing**: CTA primario *Download* + sub-buttons macOS Apple Silicon / macOS Intel / Windows / Linux. Sin "Sign up", sin email gate.
- **Apohara actual**: README §Install con 3 paths (curl|sh, brew, manual download) + npx-cli; build matriz Linux/macOS/Windows en `.github/workflows/desktop-release.yml`.
- **Status**: PARCIAL.
- **Evidencia**:
  - `README.md:13-35`: tres métodos de install — `curl|sh` (`:17`), `brew install` (`:25`), descarga manual (`:31`). Las plataformas se mencionan en `scripts/install.sh:1` (detecta linux-x64/linux-arm64/darwin-x64/darwin-arm64).
  - `npx-cli/README.md:60-66` lista los 6 assets esperados (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`).
  - **PERO** README NO presenta 3 botones de plataforma como Download CTA prominente — es texto + bash snippets que el lector tiene que parsear.
  - Plan §11.6 prescribió: *"Download CTA: 3-platform buttons (macOS/Windows/Linux)"* (`:10769`). No fue ejecutado.
  - `ROADMAP.md:210` deja claro que Linux .deb está verificado pero macOS + Windows binaries dependen de CI runners — los binarios todavía no están publicados en GH Releases.
- **Gap**: el infra de download por plataforma existe (install.sh + npx + workflow); el **front-door visual** (3 botones download-by-platform) no.
- **Recomendación**: una vez que `desktop-release.yml` produzca artifacts para los 3 OS, agregar al README justo después del headline una tabla o 3 botones markdown con links directos a `releases/latest/download/apohara-desktop-{plataforma}` (per shield-style badges).

---

### Finding 8: Pain-point framing instead of feature spec lists

- **Origen landing**: copy reframe specs como pain relief — *"No more clicking through terminal tabs"*, *"Stay in Nimbalyst to edit CSV files instead of jumping between editors and terminals"*.
- **Apohara actual**: `README.md` §"What's in v1.0" lista features como specs (`bullets de "Multi-agent scheduler", "Sandbox crate", "Code indexer"...`).
- **Status**: NO IMPLEMENTADO.
- **Evidencia**:
  - `grep -ni "no more"` en `README.md PRINCIPLES.md` — sin resultados.
  - `README.md:68-82` está estructurado como inventario de capabilities, no pain-relief mapping.
  - Plan §11.6 prescribió un grid pain→relief de 5 items (`docs/superpowers/plans/2026-05-22-apohara-v1.md:10770-10776`):
    - *"No more 'which agent broke main?'"* → semantic locks + SHA-256 ledger
    - *"No more API key juggling across machines"* → CLI wrapper providers
    - *"No more 'the judge agreed with itself'"* → dual-arbiter judge≠critic mesh
    - *"No more lost progress on crash"* → preserve_on_fail worktrees + ledger replay
    - *"No more 'where did this number come from?'"* → INV-15 Z3-verified bounded-staleness
  - Este pain-relief grid NO fue shipeado en el README rewrite (`4a76302`).
- **Gap**: el README presenta arquitectura. Para un lector que aterriza en GitHub, no hay diagrama mental del "qué dolor me quita Apohara".
- **Recomendación**: insertar el pain→relief grid de 5 items entre §"Why Apohara" y §"Install" en el README. Ya está pre-escrito en el plan; sólo necesita copiar y formatear como tabla markdown.

---

### Finding 9: Free-forever + "Team coming soon" open-core hint

- **Origen landing**: `/pricing/` Individual = $0, Team = TBD coming soon + waitlist mechanic.
- **Apohara actual**: MIT, sin pricing page, sin waitlist. Marketplace **explícitamente rechazado** en sprint plan.
- **Status**: NO IMPLEMENTADO (con caveat: el mecanismo waitlist no es marketplace; marketplace ES RECHAZADO).
- **Evidencia**:
  - `docs/superpowers/plans/2026-05-22-reference-mining-sprints.md:221`: *"Marketplace business model | nimbalyst | Defer"* — RECHAZADO.
  - `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3103`: *"Plugin marketplace (a la Vercel). Skills system sí (§7.5.5); marketplace UI no."*
  - Pero la finding distingue marketplace de waitlist: *"el waitlist mechanic es reusable: incluso para un proyecto fully-OSS, 'join the early-adopter list' es una forma de capturar emails y semillar comunidad antes del launch"*.
  - `grep -ni "waitlist\|early adopter\|early.adopter\|join.the"` en docs user-facing — sin resultados.
  - Discord mencionado en `ROADMAP.md:214,260` como milestone (v0.1 ship: "50 beta users via Discord", v0.2 ship: "Public Discord 500 users") pero ningún link en README/PRINCIPLES.
- **Gap**: el mecanismo waitlist + email capture no existe ni siquiera como link "Discord invite". Se diferencia del marketplace rechazado.
- **Recomendación**: añadir al README una sección "Get involved" con (a) link al Discord cuando exista, (b) opcionalmente un Tally/Listmonk form para "early-adopter announce list". No requiere paid SaaS — sólo un email capture.

---

### Finding 10: Two long-form essay CTAs surfaced on homepage

- **Origen landing**: 2 essays surfaced en homepage — *"Read: Integrate the 80% that matters"* + *"Read: Invest in your harness"*.
- **Apohara actual**: cero essays publicados. No existe `docs/essays/` o `docs/blog/`.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**:
  - `find docs/ -type d -iname "essays" -o -iname "blog"` — sin resultados.
  - `grep -ni "essay\|blog\|launch post"` en docs/* user-facing — sin resultados.
  - Plan §11.6 + spec §8.3 prescribieron 2 launch essays (`docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3215`):
    1. *"Why we shipped a Z3 proof with our agent orchestrator"* (HN bait)
    2. *"Locks, not vibes: how Apohara coordinates 5+ agents on one repo"* (dev-focused)
  - Ninguno fue redactado/commiteado.
- **Gap**: dos artefactos de positioning que harían lift orgánico para HN/Twitter no existen. El Z3 paper existe (ContextForge zenodo DOI) pero sin essay companion para el lector que no quiere leer un PDF académico.
- **Recomendación**: redactar al menos un essay como `docs/essays/locks-not-vibes.md` (más fácil que el Z3 essay, no requiere expertise formal). Linkear desde README §Links. Es trabajo de copywriting, no de código.

---

### Finding 11: Visual editors as the wedge, not the foundation

- **Origen landing**: 9 feature categories liderando con Markdown Editor + Drawing/Diagrams (UX features), enterrando Context Graph + MCP (technical) en posiciones 6-7.
- **Apohara actual**: README sin screenshot hero; engineering-first framing (Z3, sandbox, ledger).
- **Status**: NO IMPLEMENTADO.
- **Evidencia**:
  - `find . -maxdepth 3 -name "*.png" -o -name "*.jpg" -o -name "*.gif" | grep -v node_modules | grep -v target` — ninguna imagen en raíz/README, sólo los icons de Tauri en `packages/desktop/src-tauri/icons/`.
  - `grep -ni "screenshot\|hero image"` en README/ROADMAP/PROJECT — sin resultados.
  - Spec §8.3 (`docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3216`): *"nimbalyst.com F11 → UX wedge hero screenshot (kanban / diff approval)"*. No shipeado.
  - El kanban + Verification Timeline existen como código (`packages/desktop/src/components/TaskBoard/`, `VerificationTimeline.tsx`) y son demo-eables; nadie tomó la screenshot.
- **Gap**: el README abre con texto pero un lector casual no ve cómo se ve Apohara funcionando. Verification Timeline mounted en footer (`App.tsx:355`) sería un excelente screenshot wedge.
- **Recomendación**: capturar 1-2 screenshots de la UI corriendo (`bun run dev` + seed-demo button: `App.tsx:309`) y commitearlas a `docs/img/`. Insertar como hero image justo bajo el headline del README.

---

### Finding 12: Mobile companion app surfaces ownership story

- **Origen landing**: iOS companion app + App Store CTA. Refuerza narrativa "work from anywhere".
- **Apohara actual**: desktop-only. iOS/Android **explícitamente rechazados** en sprint plan.
- **Status**: RECHAZADO.
- **Evidencia**:
  - `docs/superpowers/plans/2026-05-22-reference-mining-sprints.md:217`: *"iOS/Android mobile companion | nimbalyst + orca | Defer hasta v2"* — RECHAZADO explícitamente para v1.0.
  - `ROADMAP.md:270` (backlog post-v0.2): *"iOS companion (Nimbalyst pattern)"* — confirmado como v2+ work, no v1.
  - El finding mismo declara *"Apohara v1.0 es desktop-only. Un mobile companion es una v2+ idea"*.
  - El finding sugirió como reusable el slot narrativo "monitor your agents from anywhere" via "Companion: web dashboard for ledger inspection" (read-only viewer del `.apohara/ledger.jsonl`). Eso tampoco existe; no se reservó como slot v1.2 explícito en el ROADMAP.
- **Recomendación**: añadir al `ROADMAP.md` §6 backlog un item *"Web ledger inspector (read-only) — companion narrative"* para evitar perder el slot mental. No requiere trabajo de v1.0.

---

### Finding 13: Footer information architecture is dense and signals maturity

- **Origen landing**: footer 4-columnas (Explore, Legal, Social, Community con 8 + 3 + 5 + 3 items).
- **Apohara actual**: `README.md:91-97` §"Links" con 5 entradas, sin agrupamiento por categoría.
- **Status**: PARCIAL.
- **Evidencia**:
  - `README.md:91-97` (§"Links") lista:
    - `PRINCIPLES.md` — *"the six commitments that drove every 'no' in v1.0"*
    - `CHANGELOG.md` — *"full v1.0.0 release notes (Keep a Changelog 1.1.0)"*
    - `ARCHITECTURE.md` — *"system diagram, request flow, crate map"*
    - `docs/github-app-setup.md`
    - `docs/release-flow.md`
  - **Falta**: ROADMAP.md, paper DOI, Discord invite, contributor guide, License (linkeado sólo desde footer line `:99`).
  - Plan §11.6 (`:10791`) prescribió footer: *"Docs · Architecture · Roadmap · Paper (INV-15) · Discord · License · Changelog"* — 7 items. Shipeado: 5 + LICENSE; faltan Roadmap, Paper, Discord, AGENTS.md/contributors.
  - Sin agrupamiento de categorías (no hay headers tipo "Explore / Community / Legal").
- **Gap**: 5 links sin estructura no transmiten "este es un producto real". Falta ROADMAP + paper DOI + Discord.
- **Recomendación**: expandir §"Links" a 3 columnas markdown:
  - **Project**: ARCHITECTURE.md · ROADMAP.md · CHANGELOG.md · PRINCIPLES.md
  - **Verification**: Paper (DOI 10.5281/zenodo.20114594) · Replay verifier
  - **Community**: Discord · GitHub Discussions · Contributing
- Mínimo viable: agregar ROADMAP.md y paper DOI al README §Links (cambio de 2 líneas).

---

### Finding 14: Voice mixes precision + plain English

- **Origen landing**: copy usa términos precisos ("worktrees", "WYSIWYG", "normalized schema") embebidos en frases en plain English, sin definir.
- **Apohara actual**: README + PRINCIPLES siguen el patrón exacto.
- **Status**: COMPLETO.
- **Evidencia**:
  - `README.md:11`: *"INV-15 is the gate; 2-of-3 majority does not ship."* — usa INV-15 como noun sin definir.
  - `README.md:7`: *"the environment scrubbed of host secrets on every spawn (§0.4)"* — usa "§0.4" como referencia, no definición.
  - `PRINCIPLES.md:18`: *"A judge model accepts the work against the spec. A critic model finds no blocking concerns. The invariant suite (tests + schema + permission lattice) is green."* — judge/critic/invariant suite mencionados, no defendidos.
  - `PRINCIPLES.md:30`: *"A permission lattice where `deny` always wins and bash compounds (`&&`, `||`, `;`) can never be granted `always` scope."* — precision + plain mix idéntico al patrón nimbalyst.
  - `CHANGELOG.md:29`: *"`enum_dispatch` instead of `Box<dyn>` for providers (§0.16)"* — términos precisos sin micro-tutorial.
- **Recomendación**: ninguna. El registro es consistente y respeta al lector.

---

### Finding 15: Visual diff approval as the "trust theater" UX pattern

- **Origen landing**: screenshots con red/green diffs + botones de approval. "Stay in control".
- **Apohara actual**: `VerificationTimeline.tsx` shipea un panel de 5 pasos visible en la UI; `PermissionDialog.tsx` ofrece allow/deny scope-aware; `CodeDiffPane.tsx` integra Monaco DiffEditor.
- **Status**: COMPLETO.
- **Evidencia**:
  - `packages/desktop/src/components/VerificationTimeline.tsx:18-24` exporta exactamente los 5 pasos prescriptos en el finding:
    ```
    lock_acquired: "Lock acquired",
    agent_acted: "Agent acted",
    judge_scored: "Judge scored",
    critic_scored: "Critic scored",
    ledger_entry_hashed: "Ledger entry hashed",
    ```
  - Montado en `packages/desktop/src/App.tsx:354-356` como footer permanente: *"<footer ...><VerificationTimeline /></footer>"* — siempre visible cuando el run corre.
  - `packages/desktop/src/components/PermissionDialog.tsx:9-78` implementa allow/deny visible con scope (once/session/always) — el "approval theater" tipo nimbalyst (`:53-61` mapean scopes a botones azules).
  - `packages/desktop/src/components/CodeDiffPane.tsx:73` usa Monaco `DiffEditor` (red/green diff) por archivo.
  - Plan §7 Task 7.10 ejecutado (`docs/superpowers/plans/2026-05-22-apohara-v1.md:10339`): *"VerificationTimeline trust theater"* — labeled trust theater desde el plan.
  - Spec §8.3 (`docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3217`): *"'Verification timeline' UI panel — trust theater visible"* — directamente cumplido.
- **Recomendación**: ninguna. La invisible guarantee del ledger SE volvió visible. Lo único pendiente (cubierto por F11) es capturar screenshot para README — fuera del scope de F15.

---

## Síntesis de prioridades

Tres gaps de mayor valor (por leverage / esfuerzo bajo):

1. **F8 pain→relief grid + F1 tagline** — copy ya pre-escrito en plan §11.6. Reescribir §"What's in v1.0" como pain→relief (5 ítems) + agregar tagline "For builders who ship". Costo: 1 hora. Impact: el README pasa de spec a copy de producto.
2. **F6 trust badges + paper DOI link** — añadir 2 shields.io badges (INV-15 Z3-verified + SHA-256 ledger) + linkear DOI 10.5281/zenodo.20114594 desde PRINCIPLES.md §3 + README §Links. Costo: 30 min. Impact: el formal-proof differential queda visible.
3. **F11 hero screenshot** — capturar 1 screenshot de la UI con seed-demo activo (kanban + VerificationTimeline footer) y commitearla a `docs/img/`. Costo: 15 min. Impact: convierte engineering-first README en producto-first.

Cuatro hallazgos COMPLETOS (F2 BYOK / F3 manifesto / F14 voice / F15 verification timeline) ya están alineados con la mensajería nimbalyst-grade. Un hallazgo RECHAZADO (F12 mobile) está fuera de scope v1.0. Los seis restantes NO IMPLEMENTADOS son trabajo de copywriting + marketing assets, no código.
