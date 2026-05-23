I have sufficient material now. Here is the comprehensive findings report.

---

# Nimbalyst Landing Page — Inspiration Report for Apohara v1.0

Fetched `https://nimbalyst.com/`, `/pricing/`, `/features/`, `/about/`, and `docs.nimbalyst.com` on 2026-05-21. Nimbalyst is the closest competitor I've seen to Apohara's positioning (multi-agent desktop workspace, BYOK, open-source, MIT-ish). The overlap is significant enough that Apohara needs to **differentiate explicitly** while learning from Nimbalyst's polished messaging.

---

## Finding 1 — "For builders" tagline + verb-first headline structure

- **Qué es**: Nimbalyst's hero headline is a single declarative sentence: *"The open-source visual workspace for building with Codex, Claude Code, and more"* — no jargon, no acronyms above the fold. Tagline: *"For builders"*.
- **Dónde**: Homepage hero, top of `https://nimbalyst.com/`.
- **Por qué inspira Apohara**: Apohara's current README opens with technical anchors (Tauri v2, Bun, Rust, ContextForge) before saying what it *does for the user*. Nimbalyst leads with **outcome + audience**, then lists the providers it orchestrates. Apohara has the same multi-provider value but buries it.
- **Cómo aplicar**: README headline rewrite + a future landing page hero. Example shape: *"The verifiable multi-AI orchestrator for builders who don't want to manage API keys."* Tagline candidates: "For engineers who ship", "For teams that audit", "For solo builders".
- **Valor**: ALTO

---

## Finding 2 — Explicit BYOK / "no API keys" framing as a value, not a footnote

- **Qué es**: Nimbalyst pricing page states *"Users provide their own API keys for AI services; Nimbalyst supplies the workspace layer"* and the about page reinforces *"No lock-in, no surprise cloud dependencies"*.
- **Dónde**: `/pricing/` ("Bring-your-own API keys; LM Studio support") and `/about/` principle #4.
- **Por qué inspira Apohara**: Apohara's CLI-wrapper differentiator (**no API keys at all** — uses the user's existing Claude Code / Codex / Copilot CLI auth) is *stronger* than Nimbalyst's BYOK. Nimbalyst still requires the user to paste keys. Apohara should weaponize this gap explicitly.
- **Cómo aplicar**: In README, add a comparison row: "API key management → Nimbalyst: BYOK paste / Apohara: zero keys, wraps your existing CLI auth". This is a concrete, demonstrable advantage.
- **Valor**: ALTO

---

## Finding 3 — Six-principle manifesto ("What Drives Us")

- **Qué es**: Nimbalyst's about page articulates six numbered principles (Visual-first, Agent management for everyone, Shared context, User ownership, Inline collaboration, Extensibility). Each is one sentence. They double as section anchors on the homepage.
- **Dónde**: `/about/` and as a homepage band titled "What Drives Us".
- **Por qué inspira Apohara**: Apohara has *implicit* principles (verifiability, formal proof, audit trail, locks-not-vibes) that show up in architecture docs but never get a manifesto treatment. A principles page would make the project legible to non-implementers (investors, contributors, journalists).
- **Cómo aplicar**: Create `PRINCIPLES.md` or expand README with a "What Drives Apohara" section. Candidate principles: (1) Verifiability over vibes (judge≠critic), (2) Locks over hopes (read/write/rename), (3) Audit over trust (SHA-256 ledger replay), (4) Local-first over cloud (Tauri desktop), (5) Wrappers over keys (CLI providers), (6) Formal over folklore (INV-15 Z3 proof).
- **Valor**: ALTO

---

## Finding 4 — Enterprise logo wall as social proof early

- **Qué es**: Above-the-fold logo wall with nine named enterprises: Automattic, Redfin, Vanta, Gainsight, Zillow, UKG, SAP, Yahoo, Delivery Hero, Noom.
- **Dónde**: Homepage, just below hero CTA.
- **Por qué inspira Apohara**: Apohara v1.0 has zero deployed users yet, so a logo wall is premature. But the *pattern* matters: planning where this will go in v1.1 changes README design today.
- **Cómo aplicar**: Reserve a "Used by" placeholder section in the README/landing template. For v1.0, replace with **GitHub stars + contributors badge + "early adopter" call** ("first 50 teams get founder Discord access"). Build the slot now, fill it later.
- **Valor**: MEDIO

---

## Finding 5 — Six named testimonials with first names + last initials

- **Qué es**: Six testimonials with photos and full names ("Satya Gunnam: Nimbalyst blew my mind from day one"). The names are not famous — they're real users from the community. Tone ranges from emotional ("blew my mind") to practical ("indispensable daily driver").
- **Dónde**: Mid-page testimonials band.
- **Por qué inspira Apohara**: For v1.0 launch, harvesting 3-5 quotes from beta testers / Discord members is achievable and gives credibility to a project most people have never heard of.
- **Cómo aplicar**: During v1.0 RC phase, run a 1-week beta with ~20 users, ask 5 for quotes. Build the testimonial slot in README now (commented out). Mix of emotional + technical voices.
- **Valor**: MEDIO

---

## Finding 6 — SOC 2 Type 2 footer badge as trust signal

- **Qué es**: Footer mentions *"SOC 2 Type 2 certified"* despite being a free open-source product.
- **Dónde**: Footer + `/features/` "Open & Secure" section.
- **Por qué inspira Apohara**: SOC 2 is overkill for a desktop app, but the *concept* (a third-party verifiable trust signal) maps to Apohara's verification mesh. Apohara has a **paper-grade trust signal** competitors don't: the INV-15 Z3 formal proof. Surface it as a badge.
- **Cómo aplicar**: Footer badge: "INV-15 ✓ Z3-verified bounded-staleness invariant" linking to the paper. Also: "SHA-256 ledger ✓ replay-verifiable". Treat them like SOC 2 — small, persistent, in every page footer.
- **Valor**: ALTO

---

## Finding 7 — Single CTA dominance: Download by platform

- **Qué es**: Primary CTA is *Download*, with sub-buttons for macOS Apple Silicon, macOS Intel, Windows, Linux. No "Sign Up", no "Book Demo", no email gate.
- **Dónde**: Homepage hero + persistent in nav.
- **Por qué inspira Apohara**: Apohara is also a Tauri desktop app. Current README points to git clone + cargo build. For v1.0, a download-first CTA with platform binaries is table stakes.
- **Cómo aplicar**: Block ROADMAP item: **release binaries via GitHub Releases** (Tauri bundler outputs .dmg / .msi / .AppImage). README hero CTA: "Download for macOS / Windows / Linux" + fallback "Build from source". Don't ship v1.0 without this.
- **Valor**: ALTO

---

## Finding 8 — Pain-point framing instead of feature spec lists

- **Qué es**: Feature copy reframes specs as pain relief: *"No more clicking through terminal tabs"*, *"no syncing between tools"*, *"Stay in Nimbalyst to edit CSV files instead of jumping between editors and terminals"*.
- **Dónde**: Homepage features section, sub-headlines under each editor type.
- **Por qué inspira Apohara**: Apohara's README currently reads like ARCHITECTURE.md (which is correct for ARCHITECTURE.md, wrong for README). Pain-point framing translates "coordinator with read/write/rename locks" → "Two agents will never overwrite each other's work".
- **Cómo aplicar**: Rewrite each feature bullet in README using `<pain> → <relief>`. Examples:
  - "No more 'which agent broke main?'" → semantic locks + SHA-256 ledger
  - "No more API key juggling across machines" → CLI wrapper providers
  - "No more 'the judge agreed with itself'" → dual-arbiter judge≠critic mesh
- **Valor**: ALTO

---

## Finding 9 — Free-forever + "Team coming soon" open-core hint

- **Qué es**: Pricing page: Individual = $0 forever, Team = TBD coming soon. Team unlocks real-time collab + admin controls + waitlist for early-adopter pricing.
- **Dónde**: `/pricing/`.
- **Por qué inspira Apohara**: Apohara is MIT — no paid SaaS in scope. But the **waitlist mechanic** is reusable: even for a fully-OSS project, "join the early-adopter list" is a way to capture emails and seed a community before launch.
- **Cómo aplicar**: README adds "Join the early-adopter list" linking to a simple form (Tally / Plausible-friendly). Even without a paid tier, this builds a list for v1.1 announcements. Position any future hosted/managed offering (e.g., team ledger sync) as optional open-core.
- **Valor**: MEDIO

---

## Finding 10 — Two long-form essay CTAs surfaced on homepage

- **Qué es**: Two essay links promoted in hero adjacent area: *"Read: Integrate the 80% that matters"* and *"Read: Invest in your harness"*. These are opinion pieces that articulate worldview.
- **Dónde**: Homepage, between features and testimonials.
- **Por qué inspira Apohara**: Worldview essays do heavy positioning work that feature lists can't. They also attract HN/Twitter discussion. Apohara has *plenty* of essay material (formal verification for agents, why CLI wrappers beat APIs, why dual-arbiter beats single-judge).
- **Cómo aplicar**: Draft 2 launch essays for v1.0:
  1. *"Why we shipped a Z3 proof with our agent orchestrator"* (paper-flavored, HN bait)
  2. *"Locks, not vibes: how Apohara coordinates 5+ agents on one repo"* (concrete, dev-flavored)
  Link both from README + future landing.
- **Valor**: ALTO

---

## Finding 11 — Visual editors as the wedge, not the foundation

- **Qué es**: Nimbalyst's 9 feature categories lead with **Markdown Editor** and **Drawing & Diagrams** — UX features — and bury technical depth (Context Graph, MCP) at positions 6-7.
- **Dónde**: `/features/` ordering.
- **Por qué inspira Apohara**: Apohara's instinct is to lead with the deepest engineering wins (Z3 proof, ledger). Nimbalyst proves users buy on **visible UX**, not engineering depth. Apohara needs at least one shiny UX wedge in the hero screenshot.
- **Cómo aplicar**: Identify Apohara's most demo-able UX surface — likely the **session kanban / orchestration view** or **diff approval flow** — and make *that* the hero screenshot. Z3 proof goes in a "Why this is different" deeper section.
- **Valor**: ALTO

---

## Finding 12 — Mobile companion app surfaces ownership story

- **Qué es**: iOS companion app for monitoring sessions remotely, with App Store CTA. Reinforces "work from anywhere, own your stack" narrative.
- **Dónde**: Homepage dedicated section + App Store link.
- **Por qué inspira Apohara**: Apohara v1.0 is desktop-only. A mobile companion is a v2+ idea, but the *narrative slot* ("monitor your agents from anywhere") is worth reserving.
- **Cómo aplicar**: ROADMAP places a "Companion: web dashboard for ledger inspection" v1.2 item. Even a read-only web viewer of `.apohara/ledger.jsonl` from a deployed binary is achievable and rhymes with Nimbalyst's mobile move without iOS overhead.
- **Valor**: BAJO

---

## Finding 13 — Footer information architecture is dense and signals maturity

- **Qué es**: Footer has 4 columns: Explore (Use Cases, Features, Pricing, Blog, Changelog, Open Source, About, Docs), Legal (3 items), Social (5 platforms), Community (Open Source, GitHub, Discord).
- **Dónde**: Site-wide footer.
- **Por qué inspira Apohara**: A dense footer signals "this is a real product, not a weekend project". Apohara's README is currently the entire site. A future landing needs at minimum: Docs, Changelog, GitHub, Discord, Roadmap, Architecture, Paper (INV-15), License.
- **Cómo aplicar**: Even before a landing exists, structure README's bottom section like a footer: clean groups of links to ARCHITECTURE.md, ROADMAP.md, CHANGELOG.md, paper PDF, Discord invite, contributor guide. Treat as template for future landing.
- **Valor**: MEDIO

---

## Finding 14 — Voice mixes precision + plain English

- **Qué es**: Copy uses precise terms ("worktrees", "WYSIWYG", "normalized schema") sparingly inside sentences that are otherwise plain English. Doesn't define them — assumes the audience knows.
- **Dónde**: Throughout, especially `/features/`.
- **Por qué inspira Apohara**: Apohara has the opposite problem: it over-defines technical terms or hides behind them. The Nimbalyst pattern — use the precise term once, embed in a plain sentence, don't explain — respects the reader and self-selects the audience.
- **Cómo aplicar**: README copy edit pass: use "judge≠critic", "Z3-verified", "CLI wrapper" as nouns inside plain sentences. Don't link or define on first use. Example: *"Apohara verifies every agent action through a judge≠critic mesh — no agent grades its own homework."*
- **Valor**: MEDIO

---

## Finding 15 — Visual diff approval as the "trust theater" UX pattern

- **Qué es**: Nimbalyst's screenshots prominently show **red/green diffs with approval buttons** before any AI edit lands. Sold as "you stay in control".
- **Dónde**: Homepage Markdown Editor + Code editor sections.
- **Por qué inspira Apohara**: Apohara has equivalent and stronger guarantees (locks + ledger + dual-arbiter). But guarantees the user can't *see* don't convert. Nimbalyst's diff-approval UI is visible trust. Apohara's ledger is invisible trust.
- **Cómo aplicar**: Design a **"verification timeline" UI panel** for Apohara that visualizes: lock acquired → agent acted → judge scored → critic scored → ledger entry hashed. Even a simple linear timeline in the Tauri UI converts the invisible guarantee into demo-able trust theater. Make it the second hero screenshot.
- **Valor**: ALTO

---

## Cross-cutting recommendation

The single highest-leverage move suggested by this analysis: **Apohara v1.0 should ship with a 5-section README** that mirrors Nimbalyst's homepage structure:

1. Hero (outcome-first headline + download CTA + 3-platform binaries)
2. Pain → relief feature grid (5-6 items, lead with UX wedge, hide depth)
3. Principles manifesto ("What Drives Apohara", 6 items)
4. Trust signals (Z3 paper badge, ledger replay badge, GitHub stars, "early adopter list" CTA)
5. Footer-style nav (Docs, Architecture, Roadmap, Paper, Discord, License)

Reserve slots for testimonials + logo wall (commented out for v1.0, populated in v1.1). Move all CLI-wrapper / coordinator / arbiter / ledger / ContextForge depth into ARCHITECTURE.md and a launch essay — the README should make a stranger want to download in 30 seconds.

Apohara's structural advantage over Nimbalyst is **zero-API-key wrapper** and **formal verification** — both should appear in finding 2 + 6 + 10 as the recurring differentiator across README, essays, and any landing page.