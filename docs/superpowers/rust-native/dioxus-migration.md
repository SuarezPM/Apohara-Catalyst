# Apohara Dioxus UI Migration Tracker

## Status por component (Sprint 9 → Dioxus)

| Component | Effort | Sprint | Status |
|---|---|---|---|
| Button primitives | Fácil | S17 | TODO |
| Input/Card primitives | Fácil | S17 | TODO |
| HeroBanner | Fácil | S17 | TODO |
| AgentStateDot | Fácil | S17 | TODO |
| RunningBorder | Fácil | S17 | TODO |
| TaskBoard | Media | S17 | TODO |
| ProviderRoster | Media | S17 | TODO |
| PermissionDialog | Media | S17 | TODO |
| KanbanBoard (HTML5 dnd) | Media | S18 | TODO |
| CommandPalette (cmdk) | Media | S18 | TODO |
| Sonner toasts | Fácil | S18 | TODO |
| TooltipProvider | Fácil | S18 | TODO |
| Resizable panels | Media | S18 | TODO |
| ViewToggle | Fácil | S18 | TODO |
| Statusline | Fácil | S18 | TODO |
| ObjectivePane | Fácil | S18 | TODO |
| TerminalPane | Duro | S19 | TODO |
| CodeDiffPane | Duro | S19 | TODO |
| SwarmCanvas DAG | Duro | S19 | TODO |

## Jotai atoms → Dioxus signals migration

| Atom (TS) | Signal (Rust) | Sprint |
|---|---|---|
| tasksAtom | TASKS GlobalSignal | S18 |
| rosterAtom | ROSTER GlobalSignal | S18 |
| permissionsAtom | PERMISSIONS GlobalSignal | S18 |
| viewModeAtom | VIEW_MODE GlobalSignal | S18 |
| sseEventsAtom | SSE_EVENTS GlobalSignal | S18 |
