# OpenSpec changes

> Spec-driven dev for Apohara. Convention lifted from chorus's
> `openspec/` pattern (see `reference/chorus/openspec/`) and adapted
> to our 3-CLI-driver world.

Every non-trivial change to Apohara — adding an MCP tool, a new
provider, a runtime knob, a new event shape — gets its own
change folder under `openspec/changes/<slug>/` BEFORE the code lands.
The folder is the spec, the design, the task list, and the per-capability
deltas in one place. Reviewers approve the FOLDER, not the diff; then
the implementer ticks the tasks off as they go.

## Layout

```
openspec/
├── README.md                              ← this file
├── changes/                               ← active proposals
│   └── <YYYY-MM-DD-slug>/
│       ├── proposal.md                    ← the elevator pitch + scope
│       ├── design.md                      ← the architecture
│       ├── tasks.md                       ← the implementation checklist
│       └── specs/
│           └── <capability>/
│               └── spec.md                ← ADDED|MODIFIED|REMOVED deltas
└── specs/                                 ← archived (post-verify)
    └── <capability>/
        └── spec.md                        ← the merged spec
```

Slug format: `YYYY-MM-DD-<kebab-case>` (matches our `docs/superpowers/`
naming, sortable by date).

## `proposal.md` template

```markdown
# <Title> — <slug>

**Status:** draft | active | approved | implementing | verified | archived
**Author:** <name>
**Created:** YYYY-MM-DD

## Why
1-3 paragraphs: what's broken / missing, who feels the pain, what
specifically a user would do differently after this lands.

## What
The deliverable in plain English. NO implementation detail here.

## What this is NOT
Scope cuts that previewers should NOT expect.

## Affects (capabilities)
- `capabilities/<name>` — bullet for each existing capability touched.
- A new capability lives here too if this proposal introduces one.

## Open questions
Anything you want a reviewer to push on.
```

## `design.md` template

```markdown
# Design — <slug>

## Affected modules
- `src/core/<...>` — what changes, why.
- `crates/<...>` — what changes, why.

## Data model deltas
SQL / schema changes, new event types, ledger payload additions.

## Algorithm sketch
Pseudocode or sequence diagram for the non-obvious parts.

## Tradeoffs considered
Brief: 2-3 alternatives + why we picked this one.

## Migration path
For breaking changes only. v1 forward-compat where possible.
```

## `tasks.md` template

```markdown
# Tasks — <slug>

## Implementation
- [ ] T-1 Add `<module>` with public API …
- [ ] T-2 Wire `<entry-point>` to consume …
- [ ] T-3 …

## Tests
- [ ] T-test-1 Unit tests for `<module>`
- [ ] T-test-2 Integration test: end-to-end <flow>

## Docs / observability
- [ ] T-doc-1 Update `CLAUDE.md` if a new "past incident" earned a rule
- [ ] T-doc-2 Add a `task_phase` event if dispatch path grows
```

## `specs/<capability>/spec.md` deltas

Each capability spec is a normal Markdown file with `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`
headers. Inside each, `### Requirement: <name>` blocks contain
`#### Scenario: WHEN/THEN` bullets the implementation MUST satisfy.

```markdown
# capabilities/<name>

## ADDED Requirements

### Requirement: <name>
The <module> MUST <invariant>.

#### Scenario: WHEN <trigger> THEN <observable>
- The <thing> emits …
- …
```

The `openspec validate <slug>` CLI (T3.1+) walks the folder and
ensures every spec delta references an existing or proposed
capability, and every `tasks.md` line item links back to at least
one Requirement.

## Lifecycle

1. **draft** — folder exists, proposal.md filled, no code yet.
2. **active** — design.md + tasks.md filled, approved by review.
3. **implementing** — commits flow, tasks check off.
4. **verified** — all tasks done, tests green, manual smoke passed.
5. **archived** — `openspec validate` passes, `openspec archive <slug>`
   moves the specs deltas into `openspec/specs/<capability>/spec.md`
   and the change folder moves to `openspec/changes/archive/`.

## Pointers

- chorus reference: `reference/chorus/openspec/changes/archive/`
  has finished examples.
- Apohara's main design lives in
  `docs/superpowers/specs/2026-05-21-apohara-v1-design.md` — `openspec`
  is for incremental change proposals on top of that base.
