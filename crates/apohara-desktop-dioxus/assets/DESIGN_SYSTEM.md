# APOHARA DESIGN SYSTEM v2

> Visual identity + token contract for `apohara-desktop-dioxus`. Polar star: the
> official Apohara brand image — deep-space black, neon lime hills, cyan/magenta
> waveforms, wireframe topography, crema wordmark. Premium data-landscape, NOT
> raw terminal.
>
> **What this replaces:** the flat phosphor-green-on-black monochrome skin in
> `assets/brand.css` (`--apohara-lime: #25B13F`, `Press Start 2P`, square
> pixel-art borders). v2 elevates it to the brand: lime as primary, cyan +
> magenta as *semantic* accents, restrained glow, multicolor gradients, while
> keeping legibility and the technical character.
>
> **Token source of truth:** the `:root { --apo-* }` block below (Section 1).
> Components consume tokens, never literals. New color needed? Add a token here
> first, then use it — copied from orca's discipline (`docs/STYLEGUIDE.md`).
>
> **Stolen architecture:** orca = token pairs (surface/foreground) + 3-tier
> elevation + state-color-is-meaning doctrine + cmdk palette + git-decoration
> convention. vibe-kanban = tri-tone brand structure + `border-flash` animated
> gradient border + kanban `grid-flow-col minmax` columns. We consciously INVERT
> orca's "color is for state only" rule — Apohara's brand *wants* glow — but keep
> its discipline (glow = emphasis tier, not decoration everywhere).

---

## 1. PALETTE

Paste-ready. Every brand color ships with a `*-fg` (foreground that meets
contrast on it) and a `*-glow` (the same hue at the alpha used for shadows).
All tints/washes are generated with `color-mix(in srgb, var(--apo-X) N%, var(--apo-bg-space))`
so there is exactly one source hue per color and neon can be dialed down for
legibility.

```css
:root {
  /* ── Backgrounds — deep space, gradient to night-blue ───────────────── */
  --apo-bg-space:    #0A0B12;  /* app canvas, deepest */
  --apo-bg-deep:     #0D1020;  /* top of vertical gradient (night-blue) */
  --apo-bg-panel:    #111525;  /* panes lifted off canvas (card surface) */
  --apo-bg-elevated: #161B30;  /* popovers, dialogs, floating cmdk */
  --apo-bg-input:    #0C0E18;  /* form-field wells, code blocks */

  /* Named vertical gradient used by the app shell + hero. */
  --apo-grad-canvas: linear-gradient(180deg, var(--apo-bg-deep) 0%, var(--apo-bg-space) 60%);

  /* ── PRIMARY — brand lime (success / primary action / brand mark) ───── */
  --apo-lime:        #A3E635;  /* the logo/hills neon-lime */
  --apo-lime-hover:  #B6F056;  /* +brightness for hover */
  --apo-lime-dim:    #7CB22B;  /* lower-emphasis lime (secondary, idle-active) */
  --apo-lime-fg:     #0A0B12;  /* text/icon ON solid lime — space-black, NEVER lime-on-lime */
  --apo-lime-glow:   rgba(163, 230, 53, 0.45);

  /* ── ACCENT cyan (info / streaming / working) ───────────────────────── */
  --apo-cyan:        #38BDF8;  /* left-side waveforms; agent "working" */
  --apo-cyan-hover:  #5CCDFA;
  --apo-cyan-dim:    #2A92C2;
  --apo-cyan-fg:     #04141F;  /* text ON solid cyan */
  --apo-cyan-glow:   rgba(56, 189, 248, 0.45);

  /* ── ACCENT magenta (warning / conflict / needs-decision) ───────────── */
  --apo-magenta:     #FB2576;  /* right-side waveforms; permission/conflict */
  --apo-magenta-hover:#FD4D90;
  --apo-magenta-dim: #C21A5B;
  --apo-magenta-fg:  #FFF0F5;  /* text ON solid magenta */
  --apo-magenta-glow:rgba(251, 37, 118, 0.45);

  /* ── Extra semantic — amber caution (between info & danger) ──────────── */
  --apo-amber:       #FBBF24;
  --apo-amber-fg:    #1A1303;
  --apo-amber-glow:  rgba(251, 191, 36, 0.4);

  /* ── Hard danger (irreversible / critical) — red, distinct from magenta */
  --apo-danger:      #F85149;
  --apo-danger-fg:   #FFF1F0;
  --apo-danger-glow: rgba(248, 81, 73, 0.45);

  /* ── Text ───────────────────────────────────────────────────────────── */
  --apo-text:        #F5F0E6;  /* crema — titles/wordmark, body on dark (~15:1 on bg-space) */
  --apo-text-dim:    #A8B0B8;  /* secondary/caption — cool-grey, ~7.6:1 WCAG AA pass */
  --apo-text-faint:  #6B7280;  /* disabled/placeholder — ~4.6:1, AA for large/UI only */
  --apo-text-on-lime: var(--apo-lime-fg);

  /* ── Borders / hairlines ────────────────────────────────────────────── */
  --apo-border:        rgba(245, 240, 230, 0.10);  /* default hairline (crema @10%) */
  --apo-border-strong: rgba(245, 240, 230, 0.18);  /* emphasized divider */
  --apo-border-lime:   color-mix(in srgb, var(--apo-lime) 40%, transparent); /* active/focused edge */

  /* ── Git decoration (VS Code convention — DO NOT invent diff colors) ── */
  --apo-diff-added:    #81B88B;
  --apo-diff-modified: #E2C08D;
  --apo-diff-deleted:  #C74E39;
  --apo-diff-renamed:  #73C991;
  --apo-diff-ignored:  #6E6E6E;

  /* ── Swarm / DAG lane colors (categorical, accessible — IBM-ish) ─────── */
  --apo-lane-1: #A3E635;  /* lime  */
  --apo-lane-2: #38BDF8;  /* cyan  */
  --apo-lane-3: #FB2576;  /* magenta */
  --apo-lane-4: #FBBF24;  /* amber */
  --apo-lane-5: #B66DFF;  /* violet */

  /* ── Named gradients ────────────────────────────────────────────────── */
  /* THE brand signature: lime → cyan → magenta. Used by the animated
     border-flash on active agents and the hero underline. */
  --apo-grad-wave:  linear-gradient(90deg, var(--apo-lime) 0%, var(--apo-cyan) 50%, var(--apo-magenta) 100%);
  --apo-grad-wave-45: linear-gradient(45deg, transparent, var(--apo-lime), var(--apo-cyan), var(--apo-magenta), transparent);
  --apo-grad-lime:  linear-gradient(90deg, var(--apo-lime) 0%, var(--apo-lime-hover) 50%, var(--apo-lime) 100%);
  --apo-grad-topo:  /* faint wireframe wash for empty-states / hero bg */
    radial-gradient(120% 80% at 50% -10%, color-mix(in srgb, var(--apo-cyan) 8%, transparent), transparent 60%);

  /* ── Spacing (4px base) + radius + z ────────────────────────────────── */
  --apo-space-1: 4px;  --apo-space-2: 8px;  --apo-space-3: 12px;
  --apo-space-4: 16px; --apo-space-6: 24px; --apo-space-8: 32px;
  --apo-radius-sm: 4px;  --apo-radius-md: 6px;  --apo-radius-lg: 10px;  --apo-radius-pill: 999px;

  /* ── Elevation (3 tiers + glow as the 4th "emphasis" tier) ──────────── */
  --apo-elev-1: 0 0 0 1px var(--apo-border);                 /* inset hairline (default) */
  --apo-elev-2: 0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px var(--apo-border); /* subtle lift */
  --apo-elev-3: 0 10px 24px rgba(0,0,0,0.55);                /* floating (popover/dialog) */
}
```

**Semantic mapping (memorize this — it is the whole color language):**

| Brand color | Meaning | Used by |
|---|---|---|
| **lime** | success · primary action · brand mark · agent done/idle-active | primary buttons, done check, hero, healthy provider, diff-added |
| **cyan** | info · streaming · agent **working** | working spinner, streaming token counter, info toast, DAG running |
| **magenta** | warning · conflict · **needs your decision** | PermissionDialog attention, conflict marker, blocked agent |
| **amber** | caution (soft) · degraded | degraded provider, rate-limit warning band |
| **danger (red)** | irreversible · critical · error | destructive buttons, critical statusline, error toast, diff-deleted |

Cancel/Dismiss/Close are **never** magenta or red — quiet ghost buttons (orca UX rule 3).

---

## 2. TYPOGRAPHY

Two families. Titles get a geometric sans (the wordmark character); data/code
stay monospace (the technical character). Ship the fonts as local `woff2`
(desktop app, no CDN); list system fallbacks.

```css
:root {
  /* Display / wordmark / pane titles — geometric, uppercase, tracked. */
  --apo-font-display: 'Space Grotesk', 'Rajdhani', 'Orbitron',
                      ui-sans-serif, system-ui, sans-serif;
  /* Body / UI labels — clean sans (Geist-like). */
  --apo-font-sans:    'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
  /* Data / paths / code / agent output — monospace (keep the tool's character). */
  --apo-font-mono:    'JetBrains Mono', 'SF Mono', ui-monospace, 'Fira Mono', monospace;
}
```

- **Primary display pick:** `Space Grotesk` (geometric, has the wordmark feel,
  free, variable). Fallbacks `Rajdhani` (condensed-tech) / `Orbitron`
  (sci-fi, use sparingly — only the wordmark, it gets illegible as body).
- **Wordmark / hero:** display family, `text-transform: uppercase`,
  `letter-spacing: 0.18em–0.24em`, color `--apo-text` (crema, not white).
- **Pane titles / section headers:** display or sans, `11px`, weight `600`,
  uppercase, `letter-spacing: 0.08em`, color `--apo-text-dim`.

**Size scale (orca roles — floor is 11px, never sub-11):**

| px | role | extras |
|---|---|---|
| 11 | meta/uppercase headers, captions, badges | weight 600 + uppercase + `ls 0.08em` for category labels |
| 12 | paths, secondary content, dense mono | |
| 13 | list rows, kanban card titles | |
| 14 | body, button text | |
| 18–22 | pane heroes | |
| 28–40 | hero wordmark | display, heavy tracking |

Global on `body`: `letter-spacing: 0.01em`, `-webkit-font-smoothing: antialiased`,
`-moz-osx-font-smoothing: grayscale` (orca's premium-pulido detail).

**KILL:** `Press Start 2P` everywhere. It is the single biggest "retro terminal"
tell. Badges/wordmark move to the display family.

---

## 3. EFFECTS

### Glow recipes (the brand's signature — but rationed)

```css
/* Text glow — titles, active labels. Subtle; never on body copy. */
--apo-text-glow-lime:    0 0 8px var(--apo-lime-glow);
--apo-text-glow-cyan:    0 0 8px var(--apo-cyan-glow);
--apo-text-glow-magenta: 0 0 8px var(--apo-magenta-glow);

/* Box glow — the ACTIVE/attention emphasis tier (the "4th elevation"). */
--apo-box-glow-lime:    0 0 0 1px var(--apo-lime),    0 0 16px var(--apo-lime-glow);
--apo-box-glow-cyan:    0 0 0 1px var(--apo-cyan),    0 0 16px var(--apo-cyan-glow);
--apo-box-glow-magenta: 0 0 0 1px var(--apo-magenta), 0 0 16px var(--apo-magenta-glow);
```

Rule: glow encodes **state = active/attention**, not decoration. A card glows
*while its agent runs*; the input glows *while a dispatch is in flight*; the
PermissionDialog glows magenta *while it needs a decision*. When idle → no glow,
just `--apo-elev-1`.

### Focus ring (accessible)

```css
--apo-focus-ring: 0 0 0 1px var(--apo-bg-space), 0 0 0 3px color-mix(in srgb, var(--apo-lime) 70%, transparent);
:where(:focus-visible) { outline: none; box-shadow: var(--apo-focus-ring); }
```

Lime halo, visible on the dark canvas, 3px so it clears WCAG focus-visibility.
Use `:focus-visible` only — no persistent decoration (orca).

### Transitions (standard)

```css
--apo-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
--apo-t-fast: 120ms var(--apo-ease);   /* hover, color */
--apo-t-base: 180ms var(--apo-ease);   /* expand/collapse, panel reveal */
--apo-t-slow: 300ms cubic-bezier(0.16, 1, 0.3, 1); /* sheet/clip-path reveals */
```

### Animated gradient border (`border-flash` — stolen from vibe-kanban)

The mask-composite trick so the gradient paints **only the border**. With
lime→cyan→magenta this IS the brand waveform.

```css
@keyframes apo-border-flash { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.apo-active-border { position: relative; }
.apo-active-border::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  border-radius: inherit; padding: 1px;
  background: var(--apo-grad-wave-45); background-size: 300% 100%;
  animation: apo-border-flash 2.4s linear infinite;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
/* attention variant (faster, single-hue) for "needs decision" */
.apo-attention-border::before { background: linear-gradient(120deg, transparent, var(--apo-magenta), transparent); animation-duration: 1.2s; }

@media (prefers-reduced-motion: reduce) {
  .apo-active-border::before, .apo-attention-border::before { animation: none; }
}
```

### Gradient usage rules

- `--apo-grad-canvas` on the shell root (vertical night-blue → space).
- `--apo-grad-wave` on hero underline, active border-flash, running progress.
- `--apo-grad-topo` only as a faint empty-state / hero backdrop wash (≤8%).
- Never gradient-fill solid buttons or text backgrounds — flows into christmas-tree.

**Every animation respects `prefers-reduced-motion: reduce`** (non-negotiable —
Apohara carries more motion than the competitors).

---

## 4. DIRECTION BY COMPONENT

Concise, actionable. "skin" = what changes visually; "steal" = source pattern;
"color" = lime/cyan/magenta application.

**HeroBanner (top)** — *skin:* wordmark in display family, uppercase, `0.2em`
tracking, crema + subtle `--apo-text-glow-lime`; backdrop `--apo-grad-topo`;
replace the `scaleX` lime underline with a `--apo-grad-wave` bar (lime→cyan→magenta
sweep). *steal:* orca titlebar 36px drag strip pattern. *color:* the wave gradient
is the only place all three colors appear at rest — it's the brand statement.

**ViewToggle (Graph/Board/Terminal)** — *skin:* chip group; active chip gets
`bg color-mix(lime 14%)` + lime text + `--apo-elev-1`; inactive `--apo-text-dim`.
*steal:* orca segmented-control sizing (11–12px). *color:* lime = active only;
no glow (it's navigation, not state).

**ProviderRoster / agent cards** — *skin:* list rows `padding 8px 12px`,
`radius-md`, idle transparent / hover `bg color-mix(lime 8%)`. Health pill recolors:
healthy=lime, degraded=amber, unknown=`--apo-text-faint`. *steal:* orca
`DashboardAgentRow` (state-dot in left gutter, agent icon, truncated prompt with
expand, hover crossfade timestamp↔dismiss via grid `[grid-area:1/1]`, NOT
display:none). *color:* per AgentStateDot map (see below). A *running* card gets
`.apo-active-border`.

**AgentStateDot (shared primitive — one vocabulary everywhere)** — *skin:* round
dot (drop the square pixel-art). *steal:* orca's single-glyph state primitive.
*color/state map:*
- `idle` → `--apo-text-faint` dot, no glow
- `working` → **cyan** spinner (`border-2 cyan, border-t-transparent, spin`)
- `waiting/permission` → **magenta** pulse
- `done` → **lime** check
- `blocked/error` → **danger** solid dot
Reuse this exact component in TaskBoard, SwarmCanvas, Statusline, ProviderRoster.

**ObjectivePane + Run** — *skin:* textarea on `--apo-bg-input`, border
`--apo-border`, focus → `--apo-border-lime` + focus-ring. Run = primary lime
button. *color:* **while a dispatch is in flight the textarea wrapper gets
`.apo-active-border`** (lime→cyan→magenta) — the 1:1 translation of the brand
waveform. Run button shows cyan working spinner during dispatch.

**SwarmCanvas / DAG** — *skin:* nodes as rounded rects on `--apo-bg-panel`,
edges `--apo-border-strong`. *steal:* orca git-graph lane palette for
multi-agent distinction. *color:* node per state — scheduled=`--apo-text-dim`
stroke, running=cyan stroke + pulse + faint cyan fill wash, completed=lime,
failed=danger. Assign each *agent* a `--apo-lane-N` for its edges so parallel
swarms are distinguishable. Empty-state uses `--apo-grad-topo` wireframe wash.

**KanbanBoard** — *skin:* columns via vibe-kanban grid:
`grid-flow-col auto-cols-[minmax(220px,1fr)]`, `divide-x` with `--apo-border`,
horizontal scroll. Sticky header per column with a column dot + a `3%` wash of
that column's color via `linear-gradient`. *steal:* vibe-kanban
KanbanProvider/Header + drop-indicator (3px pill with glow box-shadow + end
nodes) + drag-preview stack-shadow (`::before/::after` translate 4/8px). *color:*
column dots — Queued=`--apo-text-dim`, Running=cyan, Review=magenta, Done=lime.

**TaskBoard** — *skin:* same card primitive as kanban; selected card gets
`ring` (focus-ring), running card gets `.apo-active-border` + the AgentStateDot
in the gutter. *steal:* vibe-kanban Card/Cards with `@hello-pangea/dnd` patterns
(or native DnD). *color:* lane tint per status column, dot per agent state.

**CodeDiffPane** — *skin:* keep mono, `--apo-bg-input` body. *steal:* orca
git-decoration tokens **verbatim** (added/modified/deleted/renamed) + orca
diff-comment card (left-accent-bar 3px, fill `color-mix(fg 5%, surface)`, `+add`
button in glyph margin, inline popover). *color:* DO NOT invent diff greens/reds
— use `--apo-diff-*`. Winner badge = lime pill. Accept = lime primary, Reject =
ghost/danger-outline (Reject of a diff IS losing work → danger is fair here;
Cancel of the *dialog* is not).

**PermissionDialog** — *skin:* centered modal on `--apo-bg-elevated`,
`--apo-elev-3`. *steal:* vibe-kanban ChatApprovalCard (variant=plan,
expand/collapse, status) + `.apo-attention-border` (magenta). *color:* **magenta**
is the whole point — the dialog announces "requires your decision" via magenta
attention border + magenta-accented header. Approve = lime primary; Deny =
danger; **Cancel = quiet ghost** (no magenta, no red, no chip — orca UX rule 3).
Render errors/risks **inline**, never in a tooltip.

**ToastContainer** — *skin:* bottom-right stack, slide-in from right, each toast
`--apo-bg-elevated` + left-accent-bar 4px + `--apo-elev-2`. *steal:* orca sonner
placement; current `.toast` markup mostly stays. *color:* left bar by kind —
success=lime, info=cyan, warn=amber, error=danger. Toasts are transient
confirmations only; persistent status goes inline (orca rule).

**Statusline (bottom)** — *skin:* `h-24px` bar, `--apo-bg-space`, top border
`--apo-border`, mono `11–12px`, `--apo-text-dim`. *steal:* orca StatusBar —
provider segments with a MiniBar rate-limit (`h-6px radius-pill`, color by %),
`ResizeObserver` → compact (<900px) / icon-only (<500px), reuse `barColor()`
logic. *color:* context-level pill — ok=lime, caution=amber, warning=magenta,
critical=danger. MiniBar fill gradient cyan→amber→danger as capacity drains.

**CommandPalette** — *skin:* `--apo-bg-elevated`, `--apo-elev-3`, sections with
11px uppercase tracked headers. *steal:* orca WorktreeJumpPalette (cmdk +
sections + `HighlightedText` match in `font-semibold` + left-gutter state-dot +
footer `FooterKey` chips Enter/Esc/↑↓ + honest empty-states + `aria-live` count).
*color:* selected row = `bg color-mix(lime 8%)` + `ring` lime; match highlight =
lime text. The only recolor vs orca is the selection accent.

---

## 5. ANTI-SLOP RULES

1. **Tri-accent with meaning, never mono-and-rainbow.** lime=primary/success,
   cyan=info/working, magenta=warning/decision. A color appearing without its
   meaning is a bug. (Inverts vibe-kanban's single flat orange; keeps orca's
   "color = state" rigor while letting lime be brand-decorative.)
2. **Glow is a state tier, not a coat of paint.** Glow only on the *active*
   element (running agent, in-flight input, decision dialog). Everything at rest
   sits on the 3-tier elevation. If more than ~2 things glow on screen, it's a
   christmas tree — pull back.
3. **One brand hue per element.** All washes/tints from
   `color-mix(in srgb, var(--apo-X) N%, var(--apo-bg-space))`. No new hex for a
   "slightly different" tint. No multi-hue fills except the named gradients.
4. **11px floor, always.** Reject any sub-11px text (vibe-kanban's 8/10px scale
   fails a11y). Use orca's size roles.
5. **Crema, not pure white.** Titles/wordmark in `--apo-text` (#F5F0E6). Pure
   `#fff` reads cold and generic; the warm crema is identity.
6. **Don't double-encode state.** One signal per state — the gutter
   AgentStateDot OR a border, not dot + bar + glow + label all at once (orca
   explicitly dropped "left bar + right dot" for just the dot).
7. **Cancel/Dismiss/Close are quiet.** Never destructive-colored, never glowing,
   never a keyboard chip. Visual weight belongs to the affirmative action.
8. **Match feedback to duration & honor reduced-motion.** <100ms no feedback;
   1–3s spinner/label-swap; 3s+ stage labels. Every glow/border-flash/waveform
   has a `prefers-reduced-motion: reduce` off-switch. Pre-reserve width so
   controls never resize mid-action.

---

## 6. brand.css REWRITE PLAN

Single file, hot-reloaded, consumed by RSX `class`/`data-*`. Order minimizes
breakage (token layer first, components inherit).

**Step 0 — backup.** `cp brand.css brand.css.bak` (per Pablo's dotfile rule).

**Step 1 — replace the `:root` token block.** Drop the entire Sprint-9 Catalyst
`:root` (lines ~3–27). Paste Section 1 + Section 2 (`--apo-font-*`) + Section 3
transition/elev tokens. Keep `--apohara-*` and `--font-mono` as **back-compat
aliases** pointing to the new tokens so nothing breaks in one pass:

| old token | → new |
|---|---|
| `--apohara-lime #25B13F` | `var(--apo-lime)` (#A3E635 — the real brand lime) |
| `--apohara-ink #0E1010` | `var(--apo-bg-space)` |
| `--apohara-bone #EDEFF0` | `var(--apo-text)` (#F5F0E6 crema) |
| `--apohara-red #d04a3c` | `var(--apo-danger)` |
| `--apohara-warn #d29922` | `var(--apo-amber)` |
| `--apohara-orange / --apohara-critical` | `var(--apo-amber)` / `var(--apo-danger)` |
| `--bg / --fg` | `var(--apo-bg-space)` / `var(--apo-text)` |
| `--space-1..4` | `var(--apo-space-1..4)` |

The aliases let every existing `color-mix(... var(--apohara-lime) ...)` rule
instantly inherit the new lime/dark/crema with zero component edits.

**Step 2 — body + global.** `background: var(--apo-grad-canvas)` (was flat
`--bg`); add `letter-spacing/font-smoothing`. Change `font-family` to
`var(--apo-font-sans)`. Replace `.press-start-2p`/`.font-display`/`.badge`
`Press Start 2P` → `var(--apo-font-display)` uppercase tracked. **De-square:**
flip every `border-radius: 0` on `.btn/.input/.badge/.agent-dot` to
`var(--apo-radius-sm/md/pill)`.

**Step 3 — AgentStateDot rewrite.** `.agent-dot { border-radius: 999px }`;
remap `.dot-working`→cyan spinner, `.dot-waiting`→magenta pulse,
`.dot-done`→lime, `.dot-error`→danger, `.dot-idle`→faint. Add the cyan
spinner keyframe.

**Step 4 — active-border.** Replace `.running-border` (lime-only sweep) with
`.apo-active-border` + `.apo-attention-border` from Section 3 (mask-composite,
lime→cyan→magenta). Repoint the `.task-card[data-running]`, objective input,
and DAG running node to it. Add `prefers-reduced-motion` block.

**Step 5 — semantic recolor pass (per-component, Section 4 order).** HeroBanner
underline → `--apo-grad-wave`. KanbanHeader column dots → cyan/magenta/lime +
3% wash. Statusline levels → lime/amber/magenta/danger. Toast bars → kind colors.
CommandPalette selected → lime 8% + ring. Diff lines → `--apo-diff-*` (replace
the `--apohara-lime/red` mixes with the git-decoration tokens). PermissionDialog
→ magenta attention border.

**Step 6 — focus + glow.** Add the global `:focus-visible` lime ring; replace ad
hoc `border-color: lime` focus states with it. Add `--apo-box-glow-*` to active
states only.

**Risks:**
- **`color-mix(... white N%)` lightening:** the old file tints by mixing toward
  `white` (e.g. `--apohara-ink, white 4%`). On the new near-black blue bg those
  read slightly cooler — acceptable, but for panels prefer the explicit
  `--apo-bg-panel/elevated` tokens instead of `ink + white N%` to keep the
  blue cast intentional. Sweep these during Step 5.
- **Contrast regressions:** verify `--apo-text-dim` (#A8B0B8) and any
  lime-on-dark label stay ≥4.5:1 after the bg shift (they do on #0A0B12; re-check
  if a panel surface gets lighter than `--apo-bg-panel`).
- **`!important` on DAG nodes** stays (SVG presentation attrs win otherwise) —
  just swap the hues.
- **Font availability:** `Space Grotesk`/`JetBrains Mono` must be bundled as
  local woff2 (desktop, no network). Until bundled, the sans/mono fallbacks hold
  the layout; the *display* fallback to system-sans loses the wordmark character
  — bundle before shipping the hero.
- **Alias debt:** the `--apohara-*` aliases are a migration bridge, not
  permanent. Schedule a follow-up to rewrite component rules onto `--apo-*`
  directly, then delete the aliases (flag as dead code, don't delete mid-pass).
