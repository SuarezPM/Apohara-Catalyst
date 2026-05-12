# Perplexity Pro consensus research prompt

**Use:** paste into Perplexity Pro with model = "Best", search depth = comprehensive, response mode = detailed. Generated as a counter-research lane alongside Claude Opus 4.7 so the two outputs can be compared for consensus.

**Today is 2026-05-12.** Generated alongside session that shipped 21 commits closing M014 + M015 + M017 in Apohara.

---

You are Perplexity Pro operating in **comprehensive search depth** with **detailed response mode**. You are conducting paid-tier research for a developer who pays for Claude Max 20x ($200/month), MiniMax M2.7 (15,000 requests / 5 hours off-peak), and Perplexity Pro. The output will be consumed alongside parallel research from Claude Opus 4.7, so your job is to find things Opus 4.7 cannot easily surface: very recent (2026) community discussions, real pricing pages, GitHub issue threads, vendor changelogs, and first-day developer feedback on shipping products.

**Hard rules for this entire investigation:**

1. Cite every non-trivial claim with a **specific URL** (not a domain root). Inline citations are mandatory.
2. For every source, include **publication date** in `YYYY-MM-DD` format. **Reject sources older than 2025-01-01** unless they are foundational reference docs (RFCs, official API references). Strongly prefer **2026** sources.
3. If you cannot find evidence for a claim, write literally **"I don't know — no source found as of <today's date>"**. Do not fabricate, do not guess, do not synthesize from training data alone.
4. Use **markdown tables** for every comparative section. No prose-only comparisons.
5. When a vendor's pricing or rate limit is unclear or paywalled, say so explicitly and link the pricing page anyway.
6. Distinguish **marketing claims** from **independent benchmarks / user reports**. Mark each finding as `[VENDOR]`, `[INDEPENDENT]`, or `[COMMUNITY]`.
7. End every section with a **"Confidence" line**: HIGH / MEDIUM / LOW, with one-sentence justification.

**Today's date is 2026-05-12.** All "recent" claims must be benchmarked against this.

---

## Background on the user (so you can tailor recommendations)

- Solo developer, Linux (kernel 7.0.4-x64v3-xanmod1, so a modern desktop Linux likely running on a workstation, not Mac).
- Currently runs Ghostty terminal. **Ghostty has crashed 4+ times in the last 30 days due to OOM events that also kill the attached Claude Code CLI session.** This is the precipitating pain.
- Active project: **Apohara**, an open-source multi-AI coding orchestrator. Stack: TypeScript on Bun runtime, Tauri shell, React frontend, Rust sandbox subprocess. Indexed at ~2972 symbols, 6099 relationships.
- Tooling already in place: `oh-my-claudecode` (OMC) orchestration layer, MCP servers `engram` (memory), `lean-ctx` (context compression), `gitnexus` (code graph), plus a tmux-based MiniMax bridge that the user describes as "fragile."
- Spend target: **+€5–50/month additional** is acceptable if ROI is clear. Above €50/month requires strong justification.
- Subscriptions: **MiniMax 2.7 is being used at <0.1% of capacity.** The user is paying for it and wasting it. Treat unlocking MiniMax as a priority.
- Two Anthropic shipments dated **2026-05-11** (yesterday) need first-day field reports: **"Claude Code Agent View"** (multi-session dashboard, requires Claude Code v2.1.139+) and **"Claude Agent SDK Managed Agents"** (Q2 2026 GA, multi-agent teams).

---

## Section 1 — Terminal Emulator Showdown 2026 for Multi-Agent AI Development

Compare **Ghostty, WezTerm, Kitty, Alacritty, Warp, and Claude Code Desktop** (if Anthropic has shipped a desktop terminal-like client; if not, say so).

Produce a markdown table with these columns: `Terminal | Latest version (as of 2026-05-12) | GPU renderer | Native multiplexing | tmux ergonomics | Memory footprint at idle | OOM survival behavior on Linux (does parent process survive child OOM?) | cgroup/systemd-run integration | Scripting/RPC API for agent dispatch | License | Active maintainer count`.

After the table, answer these specific questions with citations:

1. **OOM survival**: when a child process (Claude Code CLI) is killed by the Linux OOM killer, does the terminal emulator survive? Find GitHub issues or community threads from **2025-2026** documenting real OOM behavior for each. The user has been bitten by Ghostty here — verify whether this is a known Ghostty bug.
2. **Memory pressure under heavy load**: cite any benchmark showing memory footprint when scrollback is large (10k+ lines) and multiple panes are open. Look for posts on Hacker News, r/commandline, r/neovim, or Ghostty's GitHub Discussions from 2025-2026.
3. **Multiplexing**: which of these have **native multiplexing without tmux** (WezTerm, Kitty do — verify versions and feature parity)? Is there a workflow advantage for AI agent dispatching over tmux+anything?
4. **Claude Code community preference**: search Anthropic's Discord (if archived posts are crawlable), r/ClaudeAI, r/LocalLLaMA, Twitter/X, and GitHub issues on `anthropics/claude-code` for terminal recommendations from late 2025 through May 2026. Which terminal do **power users** of Claude Code actually run?
5. **Wayland vs X11 considerations on Linux** — relevant because the user is on a modern Linux kernel and may be on Wayland.

End with a **single concrete recommendation** for the user's profile (Linux, multi-agent dev, OOM-burned), including a one-line migration command if applicable.

**Confidence: __**

---

## Section 2 — MiniMax M2.7: Direct API Access Beyond the tmux Bridge

The user currently invokes MiniMax via `~/.claude/scripts/tmux-minimax.sh` which drives the **opencode CLI inside a tmux pane**. He wants to bypass this and use the MiniMax HTTP API directly.

Investigate and produce:

1. **Official MiniMax API endpoints** for M2.7 (and any newer model shipped before 2026-05-12). Look at the official MiniMax developer portal (likely `platform.minimax.io` or `intl.minimaxi.chat` — verify the current URL). Provide the exact `POST` endpoint for chat completions, the auth header format (Bearer? API key in body?), and OpenAI-compatibility status (is there a drop-in OpenAI-compatible endpoint? Many Chinese model vendors ship one — confirm for MiniMax).
2. **Rate limits**: confirm the user's claim of **15,000 requests / 5 hours off-peak, 100 TPS**. Verify off-peak window (UTC hours), peak window pricing/limits, and whether limits are per-key or per-account.
3. **Pricing**: input/output token price per million for M2.7. Compare to Claude Sonnet 4.5/4.7, GPT-5, Gemini 2.5 Pro as of May 2026. Markdown table.
4. **TypeScript/Bun SDK status**: is there an official SDK? If not, is there a maintained community SDK on npm? List the top 3 community libraries with GitHub stars, last commit date, and weekly downloads. Verify they work with Bun (some npm packages break on Bun — flag if known).
5. **Python SDK status**: same drill.
6. **OpenAI-SDK compatibility shim**: if MiniMax exposes an OpenAI-compatible base URL, document the exact `baseURL` and how to point the official `openai` npm package at it. This is the cheapest integration path and likely what the user actually wants.
7. **Where MiniMax M2.7 beats Claude/GPT-4/Gemini**: find independent benchmarks from 2026 covering (a) long-context recall ≥200k tokens, (b) multilingual (especially Chinese), (c) bulk classification/extraction, (d) cost per useful token. Cite LMSys Arena, SEAL, or HuggingFace open leaderboard entries dated 2026.
8. **Production case studies**: any company publicly stating they run MiniMax in production multi-agent systems? Search engineering blogs from 2025-2026.
9. **Concrete migration recipe**: a ~15-line TypeScript/Bun snippet showing how to replace the tmux bridge with a direct HTTP call. Include retry logic and the exact env var name.

End with a **TCO comparison**: "tmux bridge cost" (latency, fragility, capacity used) vs "direct API cost" (latency, $/month at user's volume).

**Confidence: __**

---

## Section 3 — Multi-Agent Orchestration Frameworks 2026: Honest Comparison

Compare in depth: **Anthropic Claude Agent SDK Managed Agents** (2026 GA), **Claude Code Agent Teams** (the `/team` feature in Claude Code), **LangGraph** (LangChain), **Microsoft AutoGen** (latest 2026 release), **CrewAI**, **OpenAI Swarm** / its 2026 successor if one shipped, and **Pydantic AI Agents** if it has matured.

Markdown table columns: `Framework | First-class multi-provider (Claude+GPT+Gemini+MiniMax in one graph)? | State management | Streaming / token-level observability | Native human-in-the-loop | Built-in tracing (Langfuse/OpenLLMetry compat?) | Local-first or cloud-required | License | Mature for production (Yes/Beta/Experimental) | Typical line-count for a 3-agent pipeline | Cost overhead (latency/$) vs raw API calls`.

Specific questions to answer:

1. **Provider mixing**: which frameworks let you put Claude, GPT, Gemini, and MiniMax in the **same agent graph** without writing custom adapters? Verify with code examples from official docs dated 2026.
2. **Debuggability**: when an agent loop misbehaves at 3am, which framework gives the most useful trace? Look for community reports / blog posts.
3. **Observability stack**: which of these integrate cleanly with **Langfuse**, **OpenLLMetry**, or **Helicone**? Cite integration docs.
4. **Performance**: any benchmark showing orchestration overhead in ms / request? Independent measurements only.
5. **Claude Agent SDK Managed Agents specifically**: what's the pricing model? Is it included in Claude Max 20x, or extra? Find Anthropic's pricing page entry for it.
6. **For the user's stack (TypeScript/Bun)**: which of these are first-class in TS? CrewAI is Python — confirm. LangGraph has JS — verify maturity vs Python.

End with: "If the user is building Apohara to orchestrate 4 models, the framework I would pick is **X** because <reason>, with **Y** as a fallback if X fails on <concern>."

**Confidence: __**

---

## Section 4 — Cloud Infrastructure for a Solo Multi-Agent Dev at €50/Month

Compare: **Hetzner Cloud**, **Lambda Labs**, **Modal**, **Together AI**, **DigitalOcean**, **Vast.ai**, **CoreWeave**, plus **Fly.io** and **Railway** (likely relevant for a solo dev). Add **Cloudflare Workers + R2** if relevant for stateless edge.

Markdown table: `Provider | Best for | Cheapest persistent CPU box (specs + €/month) | Cheapest GPU burst (per-hour) | Cold start time | Bun runtime support | Long-running process support | Region (EU?) | Egress costs | Free tier | Real-user gotchas (1 line from forum) | URL`.

Specific scenarios — answer each with a concrete monthly-cost calculation:

1. **Persistent FastAPI + Bun.serve + sqlite stack, 1 vCPU 2GB RAM, 100GB egress/month, 24/7**: cheapest provider, real €/month including hidden fees.
2. **Burst to GPU for occasional llama-cpp inference (~10 hours/month of a single A10 or equivalent)**: cheapest by total monthly cost.
3. **Run a self-hosted MCP server reachable from Claude Code over the public internet (HTTPS)**: which provider has the cleanest TLS + custom-domain story under €5/month?
4. **EU data residency**: which providers can guarantee Frankfurt/Helsinki/Falkenstein? Important if the user is in EU (high probability given €-pricing in the brief).
5. **Vast.ai trust issue**: is Vast.ai safe for hosting API keys, or is the consensus "GPU rental only, never put secrets on it"? Cite community reports.
6. **Hetzner CCX13 vs CPX21 vs CAX11** (ARM): real-world recommendation for the persistent workload.

End with a **stacked recommendation**: "For €X/month total, run A on Provider 1 and burst B on Provider 2."

**Confidence: __**

---

## Section 5 — Claude Code Agent View (Shipped 2026-05-11) — First-Day Field Report

This shipped **yesterday**. I need first-day developer feedback, not marketing copy.

1. **Official changelog / blog post URL** with publication date 2026-05-11 or 2026-05-12.
2. **Invocation**: exact CLI commands or keybindings to open Agent View. Minimum Claude Code version (the user says v2.1.139+ — verify).
3. **Subscription tier required**: Free, Pro, Max 5x, Max 20x, Team, Enterprise — which tiers see it? Cite Anthropic's pricing or feature matrix.
4. **Relationship to Claude Agent SDK Managed Agents**: are these the **same product** (Agent View is the UI for Managed Agents) or **complementary** (Agent View is a local dashboard, Managed Agents is a cloud orchestration primitive)? Look at Anthropic engineering blog, official docs, and developer Twitter threads from 2026-05-11/12.
5. **Limitations on day one**: any known bugs, missing features, platform restrictions (macOS-only at launch? Linux later?)? Search GitHub issues on `anthropics/claude-code` opened on 2026-05-11/12.
6. **Developer reactions**: pull 3-5 quotes from Twitter/X, r/ClaudeAI, Hacker News, or Anthropic Discord, each with the original URL and post date. Mark sentiment: positive / mixed / negative.
7. **How it compares to existing community solutions**: claude-squad, omc-teams, terminal-based tmux dashboards. Does Agent View replace them or coexist?

**Confidence: __**

---

## Section 6 — Top MCP Servers a Solo Developer Should Install in May 2026

The user already runs: `engram` (memory), `lean-ctx` (context compression), `gitnexus` (code graph), plus the standard `oh-my-claudecode` set.

Investigate the **MCP ecosystem as of May 2026** and produce a ranked top-10 list of MCP servers that meaningfully change a solo developer's workflow. For each:

`Rank | MCP server name | Maintainer (official vendor? community?) | Install command for Claude Code | Killer use case (1 sentence) | Setup friction (1=trivial, 5=painful) | Auth required | Free / paid | Last commit date | GitHub stars | URL`.

Required candidates to evaluate (include even if you reject them, with reason):

- **GitHub MCP** (official Anthropic or community fork — verify which is canonical in 2026)
- **Linear MCP**
- **Slack MCP**
- **Notion MCP**
- **Browser/Playwright MCP** (browser automation)
- **Filesystem MCP**
- **Postgres / SQLite MCP**
- **Sentry MCP**
- **Sequential Thinking MCP**
- **Puppeteer/Browserbase MCP**
- **Time MCP** / **Memory MCP** (Anthropic reference)
- **Cloudflare MCP**
- **Stripe MCP** (if Apohara monetizes)
- Any **2026 standouts** the user wouldn't have heard of.

For each, state **how it changes the workflow** with a concrete one-line example: "Without it I would <X>. With it I just say <Y> and Claude does it."

Reject servers that are abandoned (no commit in 6+ months) or duplicate existing capability.

**Confidence: __**

---

## Section 7 — Brutal Honest Take

Drop the diplomatic register. You are advising one developer with finite money and finite attention.

Answer in 250-400 words:

1. Of the spend categories surfaced above (better terminal, MiniMax direct API, paid orchestration framework, cloud VM, additional MCP paid tiers), **which single €5-30/month addition has the highest ROI** for this specific user, given he already pays Claude Max 20x + MiniMax + Perplexity Pro and is wasting 99.9% of MiniMax capacity?
2. **What should he NOT spend on?** Name names.
3. **What "free" change would move the needle most** — better terminal swap, killing the tmux bridge, adding 2 MCP servers, or restructuring his agent topology?
4. **The MiniMax waste**: at 15k req / 5h, at his current <0.1% utilization, is there an *honest* reason to keep paying for MiniMax separately, or should he cancel it and route those workloads to a cheaper API (DeepSeek V3, Qwen 3, GLM-4.6)? Run the numbers.
5. **The Anthropic-shipped-yesterday question**: is Claude Code Agent View worth restructuring his Apohara orchestration around, or wait 4-8 weeks for the dust to settle and community wrappers to emerge?

Be specific. Use numbers. If you're uncertain, say so. The user explicitly asked for brutal — do not soften.

**Confidence: __**

---

## Output Format Requirements

- One H2 per section, in the order above.
- Every comparative claim → markdown table.
- Every fact → inline citation `[Source Title — YYYY-MM-DD](URL)`.
- Every section ends with `**Confidence: HIGH/MEDIUM/LOW**` and a one-sentence why.
- Final line of the entire response: a **bibliography** of every URL cited, deduplicated, sorted by date descending.
- If any section yields fewer than 5 citations dated ≥2025-01-01, state that explicitly and explain the search gaps you hit.

Begin the investigation now.
