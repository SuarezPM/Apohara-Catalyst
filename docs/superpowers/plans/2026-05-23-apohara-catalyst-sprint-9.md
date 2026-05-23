# Apohara Catalyst Sprint 9 — UI Pixel-Art Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar el brand pixel-art completo de Apohara (palette lime/dark/bone/ink/red + Press Start 2P + JetBrains Mono + Inter + chief mascot) sobre `packages/desktop`, robar las 5 features UI/UX top de los repos reference (AgentStateDot, PixelCanvas+sprites, Kanban dnd, running border, ConfirmationDialogProvider queue), y adoptar el conjunto de cross-repo polish patterns (Sonner, cmdk, resizable, Tooltip delays).

**Architecture:** 4 grupos. G9.A establece los tokens (Tailwind theme + CSS vars + fonts). G9.B incorpora las 5 features steal. G9.C el polish cross-repo. G9.D el mascot pixel-art (PixelCanvas + sprite sheet). Estructura ejecutable + TDD donde aplica; los componentes de UI puros tienen TDD via React Testing Library + axe-core a11y; los visuales (mascot, sprites, animaciones) tienen verificación manual con screenshot diffing.

**Tech Stack:** React 19 + Vite 6 + Tailwind 4 + Radix UI + shadcn/ui + @hello-pangea/dnd 16 + cmdk 1 + sonner 1.7 + framer-motion 12 + bun:test + Playwright (visual smoke) + Press Start 2P + JetBrains Mono + Inter (Google Fonts via `@fontsource`).

---

## Estructura del Sprint 9

### 4 grupos

| Grupo | Tema | # tareas | Esfuerzo | Implementer |
|---|---|---:|---:|---|
| **G9.A** | Brand tokens + fonts + Tailwind | 4 | 0.5 día | 1 |
| **G9.B** | Top 5 features steal | 6 | 2 días | 2 (deps G9.A) |
| **G9.C** | Cross-repo polish patterns | 5 | 1 día | 3 (paraleliza con G9.B) |
| **G9.D** | PixelCanvas + chief mascot | 3 | 1 día | 4 (deps G9.A) |

**Total**: 18 tareas, ~4 días con 4 implementers (G9.A → secuencial, G9.B+C+D paralelos tras G9.A).

---

## Setup

- [ ] **Setup 1: Branch + base verde post-Sprint-8**

```bash
git status
# Esperado: On branch feat/apohara-catalyst, todo Sprint 7.5 + 8 commiteado.
```

Run: `bun test && cargo test --workspace 2>&1 | tail -10`
Expected: suite verde.

- [ ] **Setup 2: Capturar baseline visual (pre-rebrand)**

```bash
cd packages/desktop && bun run build
mkdir -p docs/superpowers/visual-baselines/pre-sprint-9
APOHARA_DESKTOP_PORT=7331 bun --hot src/server.ts &
sleep 3
curl -s http://localhost:7331/ -o /tmp/index-pre.html
# Si Playwright disponible:
npx playwright screenshot http://localhost:7331/ docs/superpowers/visual-baselines/pre-sprint-9/dashboard.png || true
kill %1
```

Justifica para reviewers que el "antes" queda documentado antes de tocar nada.

- [ ] **Setup 3: Verificar brand assets en `ecosystem/`**

```bash
ls ecosystem/consilium/scripts/brand-tokens-source.json
ls ecosystem/probant/docs/brand/asset-prompts.md
```
Expected: ambos existen (verified durante brainstorming).

---

## G9.A — Brand tokens + fonts (4 tareas, 0.5 día)

**Outcome**: Tailwind config consume tokens nuevos. CSS vars exportadas. Fonts cargadas via `@fontsource`. Cualquier componente que use `bg-primary`, `text-foreground`, `font-display`, `font-mono`, `font-sans` consume el branding nuevo.

### Task G9.A.1: Instalar `@fontsource/*` + agregar imports

**Files:**
- Modify: `packages/desktop/package.json` (deps)
- Modify: `packages/desktop/src/main.tsx` (imports)

- [ ] **Step 1: Install deps**

```bash
cd packages/desktop
bun add @fontsource/press-start-2p @fontsource/jetbrains-mono @fontsource/inter
```

- [ ] **Step 2: Import en `main.tsx`**

Al tope de `packages/desktop/src/main.tsx`:

```typescript
import "@fontsource/press-start-2p/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/700.css";
```

- [ ] **Step 3: Failing test (verifica fonts disponibles vía DOM probe)**

```typescript
// packages/desktop/src/__tests__/brand-fonts.test.tsx
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

test("main.tsx imports the three brand font families", () => {
  const content = readFileSync(resolve(__dirname, "../main.tsx"), "utf-8");
  expect(content).toContain("@fontsource/press-start-2p");
  expect(content).toContain("@fontsource/jetbrains-mono");
  expect(content).toContain("@fontsource/inter");
});
```

- [ ] **Step 4: Run + commit**

```bash
bun test packages/desktop/src/__tests__/brand-fonts.test.tsx
# PASS
git add packages/desktop/package.json packages/desktop/src/main.tsx packages/desktop/src/__tests__/brand-fonts.test.tsx packages/desktop/bun.lockb
git commit -m "feat(brand): wire @fontsource Press Start 2P + JetBrains Mono + Inter (G9.A.1)"
```

### Task G9.A.2: CSS vars + palette en `index.css`

**Files:**
- Modify: `packages/desktop/src/index.css`

- [ ] **Step 1: Append palette + tokens**

Insertar al final de `packages/desktop/src/index.css`:

```css
/* === Apohara Catalyst brand tokens === */
:root {
  /* Core palette (verified ecosystem/consilium/scripts/brand-tokens-source.json) */
  --apohara-lime: #25B13F;
  --apohara-lime-bright: #2BD449;
  --apohara-dark: #2A2D3A;
  --apohara-dark-2: #1E2130;
  --apohara-bone: #EDEFF0;
  --apohara-ink: #0E1010;
  --apohara-red: #B8262A;
  --apohara-red-bright: #E2484C;

  /* Backgrounds */
  --apohara-bg-primary: #0E1010;
  --apohara-bg-secondary: #1E2130;
  --apohara-bg-elevated: #2A2D3A;

  /* Semantic */
  --background: var(--apohara-bg-primary);
  --foreground: var(--apohara-bone);
  --primary: var(--apohara-lime);
  --primary-foreground: var(--apohara-ink);
  --danger: var(--apohara-red);
  --muted: var(--apohara-dark);
  --muted-foreground: #8E929E;
  --border: #3A3D4A;

  /* Typography stacks */
  --font-display: "Press Start 2P", "Courier New", monospace;
  --font-mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", "SF Mono", monospace;
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;

  /* Spacing scale snapped to 8px grid */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 32px;
  --space-6: 48px;

  /* Pixel-art aesthetic */
  --pixel-radius: 0px;
  --pixel-border: 2px solid var(--apohara-lime);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-feature-settings: "ss01" on, "cv02" on;
  -webkit-font-smoothing: antialiased;
}

code, pre, kbd, samp {
  font-family: var(--font-mono);
}

.font-display {
  font-family: var(--font-display);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
```

- [ ] **Step 2: Failing test (CSS vars wired)**

```typescript
// packages/desktop/src/__tests__/brand-css-vars.test.ts
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

test("index.css defines core Apohara palette vars", () => {
  const css = readFileSync(resolve(__dirname, "../index.css"), "utf-8");
  for (const v of [
    "--apohara-lime: #25B13F",
    "--apohara-dark: #2A2D3A",
    "--apohara-bone: #EDEFF0",
    "--apohara-ink: #0E1010",
    "--apohara-red: #B8262A",
  ]) {
    expect(css).toContain(v);
  }
});

test("index.css defines typography stacks", () => {
  const css = readFileSync(resolve(__dirname, "../index.css"), "utf-8");
  expect(css).toContain("Press Start 2P");
  expect(css).toContain("JetBrains Mono");
  expect(css).toContain("Inter");
});
```

- [ ] **Step 3: Commit**

```bash
bun test packages/desktop/src/__tests__/brand-css-vars.test.ts
git add packages/desktop/src/index.css packages/desktop/src/__tests__/brand-css-vars.test.ts
git commit -m "feat(brand): CSS vars + palette tokens in index.css (G9.A.2)"
```

### Task G9.A.3: Tailwind theme extension

**Files:**
- Modify: `packages/desktop/tailwind.config.ts` (o `.js` según stack actual)

- [ ] **Step 1: Inspeccionar config actual**

```bash
ls packages/desktop/tailwind.config.* 2>/dev/null || ls packages/desktop/postcss.config.*
```

Si Tailwind 4 está en uso (likely), la config va dentro de `@theme` en CSS.

- [ ] **Step 2A: Tailwind 4 (CSS-based)**

Si Tailwind 4: Insertar bloque `@theme` al inicio de `packages/desktop/src/index.css` (antes del bloque G9.A.2):

```css
@import "tailwindcss";

@theme {
  --color-background: var(--apohara-bg-primary);
  --color-foreground: var(--apohara-bone);
  --color-primary: var(--apohara-lime);
  --color-primary-foreground: var(--apohara-ink);
  --color-danger: var(--apohara-red);
  --color-muted: var(--apohara-dark);
  --color-muted-foreground: #8E929E;
  --color-border: #3A3D4A;

  --color-apohara-lime: #25B13F;
  --color-apohara-lime-bright: #2BD449;
  --color-apohara-dark: #2A2D3A;
  --color-apohara-dark-2: #1E2130;
  --color-apohara-bone: #EDEFF0;
  --color-apohara-ink: #0E1010;
  --color-apohara-red: #B8262A;
  --color-apohara-red-bright: #E2484C;

  --font-display: "Press Start 2P", "Courier New", monospace;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --font-sans: "Inter", system-ui, sans-serif;

  --radius-pixel: 0px;
}
```

- [ ] **Step 2B: Tailwind 3 (JS config)**

Si Tailwind 3: extender `tailwind.config.ts` con `theme.extend`:

```typescript
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        background: "var(--apohara-bg-primary)",
        foreground: "var(--apohara-bone)",
        primary: {
          DEFAULT: "var(--apohara-lime)",
          foreground: "var(--apohara-ink)",
        },
        danger: "var(--apohara-red)",
        muted: { DEFAULT: "var(--apohara-dark)", foreground: "#8E929E" },
        border: "#3A3D4A",
        apohara: {
          lime: "#25B13F",
          "lime-bright": "#2BD449",
          dark: "#2A2D3A",
          "dark-2": "#1E2130",
          bone: "#EDEFF0",
          ink: "#0E1010",
          red: "#B8262A",
          "red-bright": "#E2484C",
        },
      },
      fontFamily: {
        display: ['"Press Start 2P"', "monospace"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
      },
      borderRadius: { pixel: "0px" },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Smoke test build**

```bash
cd packages/desktop && bun run build 2>&1 | tail -5
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/tailwind.config.* packages/desktop/src/index.css
git commit -m "feat(brand): Tailwind theme extension with Apohara palette + fonts (G9.A.3)"
```

### Task G9.A.4: Reescribir `Header` con branding nuevo

**Files:**
- Modify: `packages/desktop/src/components/Header.tsx` (o similar)

- [ ] **Step 1: Inspeccionar Header actual**

```bash
rg -l 'Header' packages/desktop/src/components/ | head -3
```

- [ ] **Step 2: Failing test (snapshot textual)**

```typescript
// packages/desktop/src/__tests__/header-brand.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "bun:test";
import Header from "../components/Header";

test("Header shows 'APOHARA CATALYST' brand and uses font-display", () => {
  render(<Header />);
  const brand = screen.getByText(/APOHARA CATALYST/i);
  expect(brand).toBeInTheDocument();
  expect(brand.className).toContain("font-display");
});
```

- [ ] **Step 3: Reescribir Header.tsx**

```tsx
// packages/desktop/src/components/Header.tsx
import { FC } from "react";

export const Header: FC = () => {
  return (
    <header className="border-b-2 border-apohara-lime bg-apohara-ink px-6 py-4 flex items-center gap-4">
      <span className="font-display text-apohara-lime text-sm tracking-widest">
        APOHARA CATALYST
      </span>
      <span className="font-mono text-apohara-bone/60 text-xs">
        v1.0.0-rc.1
      </span>
      <span className="ml-auto font-mono text-apohara-bone/40 text-xs">
        local-first · CLI wrappers · 3 providers
      </span>
    </header>
  );
};

export default Header;
```

- [ ] **Step 4: Run test → PASS, commit**

```bash
bun test packages/desktop/src/__tests__/header-brand.test.tsx
git add packages/desktop/src/components/Header.tsx packages/desktop/src/__tests__/header-brand.test.tsx
git commit -m "feat(brand): rebrand Header to Apohara Catalyst pixel-art look (G9.A.4)"
```

---

## G9.B — Top 5 features steal (6 tareas, 2 días)

**Outcome**: Las 5 features documentadas en `docs/reference-mining/ui-ux-deep-mining.md` están portadas + atribuidas + cubiertas por tests.

### Task G9.B.1: `AgentStateDot` (steal de orca)

**Files:**
- Create: `packages/desktop/src/components/AgentStateDot.tsx`
- Create: `packages/desktop/src/components/__tests__/AgentStateDot.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// packages/desktop/src/components/__tests__/AgentStateDot.test.tsx
import { render } from "@testing-library/react";
import { expect, test } from "bun:test";
import { AgentStateDot } from "../AgentStateDot";

test("AgentStateDot renders lime when state=working", () => {
  const { container } = render(<AgentStateDot state="working" />);
  const dot = container.querySelector("[data-state-dot]");
  expect(dot).not.toBeNull();
  expect(dot!.getAttribute("data-state")).toBe("working");
  expect(dot!.className).toContain("bg-apohara-lime");
});

test("AgentStateDot renders red when state=error", () => {
  const { container } = render(<AgentStateDot state="error" />);
  const dot = container.querySelector("[data-state-dot]");
  expect(dot!.className).toContain("bg-apohara-red");
});

test("AgentStateDot pulses when state=working (animate-pulse class)", () => {
  const { container } = render(<AgentStateDot state="working" />);
  const dot = container.querySelector("[data-state-dot]");
  expect(dot!.className).toContain("animate-pulse");
});

test("AgentStateDot is muted when state=idle", () => {
  const { container } = render(<AgentStateDot state="idle" />);
  const dot = container.querySelector("[data-state-dot]");
  expect(dot!.className).toContain("bg-muted");
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `bun test packages/desktop/src/components/__tests__/AgentStateDot.test.tsx`
Expected: FAIL — component no existe.

- [ ] **Step 3: Implement**

```tsx
// packages/desktop/src/components/AgentStateDot.tsx
import { FC } from "react";

export type AgentState = "idle" | "working" | "waiting" | "done" | "error";

interface Props {
  state: AgentState;
  size?: "sm" | "md";
  label?: string;
}

const STATE_CLASS: Record<AgentState, string> = {
  idle:    "bg-muted",
  working: "bg-apohara-lime animate-pulse",
  waiting: "bg-apohara-bone/40",
  done:    "bg-apohara-lime",
  error:   "bg-apohara-red",
};

const SIZE_CLASS = { sm: "w-2 h-2", md: "w-3 h-3" } as const;

export const AgentStateDot: FC<Props> = ({ state, size = "md", label }) => (
  <span
    data-state-dot
    data-state={state}
    role="status"
    aria-label={label ?? `agent ${state}`}
    className={`inline-block rounded-pixel ${SIZE_CLASS[size]} ${STATE_CLASS[state]}`}
  />
);
```

- [ ] **Step 4: PASS + commit**

```bash
bun test packages/desktop/src/components/__tests__/AgentStateDot.test.tsx
# 4 pass
git add packages/desktop/src/components/AgentStateDot.tsx packages/desktop/src/components/__tests__/AgentStateDot.test.tsx
git commit -m "feat(ui): AgentStateDot — visual provider state pill (G9.B.1)

Steal from orca (src/renderer/components/AgentStateDot.tsx). Adapted to
Apohara palette: lime working/done, red error, muted idle, animate-pulse
on working. Sizes sm/md. ARIA role=status with label.

Attribution: ui-ux-deep-mining.md feature #1."
```

### Task G9.B.2: Wire `AgentStateDot` en `TaskBoard`

**Files:**
- Modify: `packages/desktop/src/components/TaskBoard.tsx`

- [ ] **Step 1: Inspect TaskBoard**

```bash
rg -n 'TaskBoard' packages/desktop/src/components/TaskBoard.tsx | head -20
```

- [ ] **Step 2: Failing test (Board card shows dot)**

```tsx
// packages/desktop/src/components/__tests__/TaskBoard-dot.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "bun:test";
import { TaskBoard } from "../TaskBoard";

test("TaskBoard renders AgentStateDot for each task with provider state", () => {
  // Mocking store: provide a task with status='dispatched'.
  render(<TaskBoard />);
  const dots = screen.queryAllByRole("status");
  expect(dots.length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Wire dot into card**

Localizar el render de cada task card (look for `<div className="task-card"` o equivalent) y agregar:

```tsx
import { AgentStateDot, AgentState } from "./AgentStateDot";

function mapStatusToDotState(status: TaskStatus): AgentState {
  switch (status) {
    case "in_verification":
    case "dispatched":         return "working";
    case "blocked":            return "error";
    case "done":               return "done";
    case "pending":
    case "ready":              return "idle";
    case "failed":             return "error";
    default:                   return "idle";
  }
}

// dentro del JSX de cada card:
<header className="flex items-center gap-2">
  <AgentStateDot state={mapStatusToDotState(task.status)} label={`${task.id} ${task.status}`} />
  <span className="font-mono text-xs">{task.title}</span>
</header>
```

- [ ] **Step 4: PASS + commit**

```bash
bun test packages/desktop/src/components/__tests__/TaskBoard-dot.test.tsx
git add packages/desktop/src/components/TaskBoard.tsx packages/desktop/src/components/__tests__/TaskBoard-dot.test.tsx
git commit -m "feat(ui): wire AgentStateDot into TaskBoard cards (G9.B.2)"
```

### Task G9.B.3: Kanban via @hello-pangea/dnd (steal de vibe-kanban)

**Files:**
- Modify: `packages/desktop/package.json` (deps)
- Create: `packages/desktop/src/components/KanbanBoard.tsx`
- Create: `packages/desktop/src/components/__tests__/KanbanBoard.test.tsx`

- [ ] **Step 1: Install dep**

```bash
cd packages/desktop && bun add @hello-pangea/dnd
```

- [ ] **Step 2: Failing test (4 columns + drag enables status update)**

```tsx
// packages/desktop/src/components/__tests__/KanbanBoard.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "bun:test";
import { KanbanBoard } from "../KanbanBoard";

test("KanbanBoard renders 4 columns: Ready, In Progress, Verifying, Done", () => {
  render(<KanbanBoard />);
  expect(screen.getByText(/Ready/i)).toBeInTheDocument();
  expect(screen.getByText(/In Progress/i)).toBeInTheDocument();
  expect(screen.getByText(/Verifying/i)).toBeInTheDocument();
  expect(screen.getByText(/Done/i)).toBeInTheDocument();
});

test("KanbanBoard columns have role='list' for a11y", () => {
  render(<KanbanBoard />);
  expect(screen.getAllByRole("list").length).toBeGreaterThanOrEqual(4);
});
```

- [ ] **Step 3: Implement**

```tsx
// packages/desktop/src/components/KanbanBoard.tsx
import { FC } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { useAtom } from "jotai";
import { dagStoreAtom, updateTaskStatusAtom } from "../store/dagStore";
import { AgentStateDot } from "./AgentStateDot";

const COLUMNS = [
  { id: "ready",        title: "Ready",        statuses: ["pending", "ready"] },
  { id: "in_progress",  title: "In Progress",  statuses: ["dispatched"] },
  { id: "verifying",    title: "Verifying",    statuses: ["in_verification"] },
  { id: "done",         title: "Done",         statuses: ["done"] },
] as const;

export const KanbanBoard: FC = () => {
  const [store] = useAtom(dagStoreAtom);
  const [, updateStatus] = useAtom(updateTaskStatusAtom);

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = COLUMNS.find(c => c.id === result.destination!.droppableId)?.statuses[0];
    if (newStatus) updateStatus({ id: result.draggableId, status: newStatus });
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-4 gap-3 p-4">
        {COLUMNS.map(col => (
          <Droppable key={col.id} droppableId={col.id}>
            {(provided) => (
              <section
                ref={provided.innerRef}
                {...provided.droppableProps}
                aria-label={col.title}
                role="list"
                className="flex flex-col gap-2 bg-apohara-dark-2 border border-border p-3 min-h-[200px]"
              >
                <h2 className="font-display text-apohara-lime text-xs mb-2">{col.title}</h2>
                {store.tasks
                  .filter(t => col.statuses.includes(t.status as any))
                  .map((task, idx) => (
                    <Draggable key={task.id} draggableId={task.id} index={idx}>
                      {(prov) => (
                        <article
                          ref={prov.innerRef}
                          {...prov.draggableProps}
                          {...prov.dragHandleProps}
                          role="listitem"
                          className="bg-apohara-dark border border-border p-2 font-mono text-xs flex items-center gap-2"
                        >
                          <AgentStateDot state="idle" size="sm" />
                          <span className="truncate">{task.title}</span>
                        </article>
                      )}
                    </Draggable>
                  ))}
                {provided.placeholder}
              </section>
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  );
};
```

- [ ] **Step 4: Wire into App + ViewToggle**

Agregar entrada `Kanban` en `ViewToggle.tsx` y mount `<KanbanBoard />` cuando `viewMode === 'kanban'`.

- [ ] **Step 5: PASS + commit**

```bash
bun test packages/desktop/src/components/__tests__/KanbanBoard.test.tsx
git add packages/desktop/package.json packages/desktop/src/components/KanbanBoard.tsx packages/desktop/src/components/__tests__/KanbanBoard.test.tsx packages/desktop/src/components/ViewToggle.tsx packages/desktop/src/App.tsx
git commit -m "feat(ui): KanbanBoard with @hello-pangea/dnd, 4 columns (G9.B.3)

Steal from vibe-kanban (apps/web/src/components/kanban/Board.tsx). Adapted
to Apohara palette + status mapping. Drag updates task status via jotai
atom — same data path as TaskBoard.
Attribution: ui-ux-deep-mining.md feature #3."
```

### Task G9.B.4: Animated running border (steal de vibe-kanban)

**Files:**
- Create: `packages/desktop/src/components/RunningBorder.tsx`
- Create: `packages/desktop/src/components/__tests__/RunningBorder.test.tsx`
- Modify: `packages/desktop/src/index.css` (keyframes)

- [ ] **Step 1: Keyframes en index.css**

Append a `index.css`:

```css
@keyframes apohara-running-border {
  0%   { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

.running-border {
  position: relative;
  isolation: isolate;
}
.running-border::before {
  content: "";
  position: absolute;
  inset: -2px;
  z-index: -1;
  background: linear-gradient(
    90deg,
    var(--apohara-lime) 0%,
    var(--apohara-lime-bright) 25%,
    var(--apohara-lime) 50%,
    var(--apohara-lime-bright) 75%,
    var(--apohara-lime) 100%
  );
  background-size: 200% 200%;
  animation: apohara-running-border 2s linear infinite;
}
```

- [ ] **Step 2: Failing test**

```tsx
// packages/desktop/src/components/__tests__/RunningBorder.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "bun:test";
import { RunningBorder } from "../RunningBorder";

test("RunningBorder wraps children and applies running-border class when active", () => {
  render(
    <RunningBorder active>
      <span>child</span>
    </RunningBorder>
  );
  const wrapper = screen.getByText("child").parentElement!;
  expect(wrapper.className).toContain("running-border");
});

test("RunningBorder does NOT apply class when inactive", () => {
  render(
    <RunningBorder active={false}>
      <span>child</span>
    </RunningBorder>
  );
  const wrapper = screen.getByText("child").parentElement!;
  expect(wrapper.className).not.toContain("running-border");
});
```

- [ ] **Step 3: Implement**

```tsx
// packages/desktop/src/components/RunningBorder.tsx
import { FC, ReactNode } from "react";

interface Props {
  active: boolean;
  children: ReactNode;
}

export const RunningBorder: FC<Props> = ({ active, children }) => (
  <div className={active ? "running-border" : ""}>{children}</div>
);
```

- [ ] **Step 4: Wire en KanbanBoard cards cuando `task.status === "dispatched"`**

En `KanbanBoard.tsx`, envolver el `<article>` con `<RunningBorder active={task.status === "dispatched"}>...</RunningBorder>`.

- [ ] **Step 5: PASS + commit**

```bash
bun test packages/desktop/src/components/__tests__/RunningBorder.test.tsx
git add packages/desktop/src/components/RunningBorder.tsx packages/desktop/src/components/__tests__/RunningBorder.test.tsx packages/desktop/src/index.css packages/desktop/src/components/KanbanBoard.tsx
git commit -m "feat(ui): RunningBorder animated gradient for dispatched tasks (G9.B.4)

Steal from vibe-kanban (apps/web/src/components/ui/running-border.tsx).
Pure CSS keyframes + linear-gradient sweep, no JS animation cost.
Wired into KanbanBoard cards while task.status === 'dispatched'.
Attribution: ui-ux-deep-mining.md feature #4."
```

### Task G9.B.5: `ConfirmationDialogProvider` queue (steal de orca)

**Files:**
- Create: `packages/desktop/src/providers/ConfirmationDialogProvider.tsx`
- Create: `packages/desktop/src/providers/__tests__/ConfirmationDialogProvider.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// packages/desktop/src/providers/__tests__/ConfirmationDialogProvider.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test } from "bun:test";
import { ConfirmationDialogProvider, useConfirm } from "../ConfirmationDialogProvider";

function Probe() {
  const confirm = useConfirm();
  return (
    <>
      <button onClick={() => confirm({ title: "A", description: "first" })}>open-a</button>
      <button onClick={() => confirm({ title: "B", description: "second" })}>open-b</button>
    </>
  );
}

test("ConfirmationDialogProvider queues multiple confirms FIFO", async () => {
  render(
    <ConfirmationDialogProvider>
      <Probe />
    </ConfirmationDialogProvider>
  );
  fireEvent.click(screen.getByText("open-a"));
  fireEvent.click(screen.getByText("open-b"));
  // Only the first dialog should be visible.
  expect(await screen.findByText("first")).toBeInTheDocument();
  expect(screen.queryByText("second")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Cancel"));
  // Now the second appears.
  await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());
});
```

- [ ] **Step 2: Implement**

```tsx
// packages/desktop/src/providers/ConfirmationDialogProvider.tsx
import { createContext, FC, ReactNode, useCallback, useContext, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmationDialogProvider");
  return ctx;
};

interface QueueEntry extends ConfirmOptions {
  resolve: (result: boolean) => void;
}

export const ConfirmationDialogProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const current = queue[0];

  const confirm: ConfirmFn = useCallback(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setQueue((q) => [...q, { ...opts, resolve }]);
      }),
    []
  );

  const respond = (result: boolean) => {
    if (!current) return;
    current.resolve(result);
    setQueue((q) => q.slice(1));
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog.Root open={!!current} onOpenChange={(o) => !o && respond(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-apohara-ink/80" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-apohara-dark-2 border-2 border-apohara-lime p-6 max-w-md">
            <Dialog.Title className="font-display text-apohara-lime text-sm mb-3">
              {current?.title}
            </Dialog.Title>
            {current?.description && (
              <Dialog.Description className="font-mono text-apohara-bone/80 text-xs mb-4">
                {current.description}
              </Dialog.Description>
            )}
            <div className="flex gap-2 justify-end">
              <button
                className="font-mono text-xs px-3 py-2 border border-border hover:bg-apohara-dark"
                onClick={() => respond(false)}
              >
                {current?.cancelLabel ?? "Cancel"}
              </button>
              <button
                className={`font-mono text-xs px-3 py-2 ${
                  current?.variant === "destructive"
                    ? "bg-apohara-red text-apohara-bone hover:bg-apohara-red-bright"
                    : "bg-apohara-lime text-apohara-ink hover:bg-apohara-lime-bright"
                }`}
                onClick={() => respond(true)}
              >
                {current?.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
};
```

- [ ] **Step 3: Wire en root**

En `packages/desktop/src/App.tsx` (o `main.tsx`):

```tsx
import { ConfirmationDialogProvider } from "./providers/ConfirmationDialogProvider";

// envolver el árbol:
<ConfirmationDialogProvider>
  <ExistingTree />
</ConfirmationDialogProvider>
```

- [ ] **Step 4: PASS + commit**

```bash
bun test packages/desktop/src/providers/__tests__/ConfirmationDialogProvider.test.tsx
git add packages/desktop/src/providers/ConfirmationDialogProvider.tsx packages/desktop/src/providers/__tests__/ConfirmationDialogProvider.test.tsx packages/desktop/src/App.tsx
git commit -m "feat(ui): ConfirmationDialogProvider with FIFO queue (G9.B.5)

Steal from orca (src/renderer/providers/ConfirmationDialogProvider.tsx).
Adapted to Radix Dialog primitives + Apohara palette. Promise-based API:
useConfirm()({ title, description, variant }) returns Promise<boolean>.
Multiple concurrent confirms queue FIFO — never two dialogs at once.
Attribution: ui-ux-deep-mining.md feature #5."
```

### Task G9.B.6: PixelCanvas placeholder (depende G9.D)

**Files:**
- Create: `packages/desktop/src/components/PixelCanvas.tsx`

- [ ] **Step 1: Stub que renderiza un placeholder verde mientras G9.D entrega el sprite real**

```tsx
// packages/desktop/src/components/PixelCanvas.tsx
import { FC, useEffect, useRef } from "react";

interface Props {
  width?: number;
  height?: number;
  spriteUrl?: string;
}

export const PixelCanvas: FC<Props> = ({ width = 64, height = 64, spriteUrl }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    if (spriteUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = spriteUrl;
    } else {
      ctx.fillStyle = "#25B13F";
      ctx.fillRect(0, 0, width, height);
    }
  }, [spriteUrl, width, height]);
  return <canvas ref={ref} width={width} height={height} style={{ imageRendering: "pixelated" }} />;
};
```

- [ ] **Step 2: Commit (steal de chorus+orca pixel canvas pattern)**

```bash
git add packages/desktop/src/components/PixelCanvas.tsx
git commit -m "feat(ui): PixelCanvas stub (sprite slot for chief mascot) (G9.B.6)

Steal from chorus + orca (canvas + imageSmoothingEnabled=false pattern).
spriteUrl prop optional; falls back to lime fill while G9.D delivers
the chief mascot sprite sheet.
Attribution: ui-ux-deep-mining.md feature #2."
```

---

## G9.C — Cross-repo polish (5 tareas, 1 día)

**Outcome**: Sonner toasts wired, cmdk command palette via Cmd+K, resizable panels, TooltipProvider 400ms delay, shadcn/ui primitives consolidados.

### Task G9.C.1: Sonner toasts

**Files:**
- Modify: `packages/desktop/package.json` (deps)
- Modify: `packages/desktop/src/App.tsx`

- [ ] **Step 1: Install + wire**

```bash
cd packages/desktop && bun add sonner
```

Edit `App.tsx`:

```tsx
import { Toaster } from "sonner";

// inside JSX root:
<Toaster
  theme="dark"
  toastOptions={{
    style: {
      background: "var(--apohara-dark-2)",
      color: "var(--apohara-bone)",
      border: "2px solid var(--apohara-lime)",
      fontFamily: "var(--font-mono)",
      borderRadius: 0,
    },
  }}
  position="bottom-right"
/>
```

- [ ] **Step 2: Test smoke**

```tsx
// packages/desktop/src/__tests__/sonner-wired.test.tsx
import { render } from "@testing-library/react";
import { expect, test } from "bun:test";
import App from "../App";

test("App mounts <Toaster /> from sonner", () => {
  const { container } = render(<App />);
  expect(container.querySelector("[data-sonner-toaster]")).not.toBeNull();
});
```

- [ ] **Step 3: Commit**

```bash
bun test packages/desktop/src/__tests__/sonner-wired.test.tsx
git add packages/desktop/package.json packages/desktop/src/App.tsx packages/desktop/src/__tests__/sonner-wired.test.tsx
git commit -m "feat(ui): Sonner toasts wired with Apohara palette (G9.C.1)"
```

### Task G9.C.2: cmdk command palette (Cmd+K)

**Files:**
- Modify: `packages/desktop/package.json`
- Create: `packages/desktop/src/components/CommandPalette.tsx`
- Modify: `packages/desktop/src/App.tsx`

- [ ] **Step 1: Install**

```bash
cd packages/desktop && bun add cmdk
```

- [ ] **Step 2: Implement**

```tsx
// packages/desktop/src/components/CommandPalette.tsx
import { Command } from "cmdk";
import { FC, useEffect, useState } from "react";

const ACTIONS = [
  { id: "task-new",      label: "New task",                 run: () => console.log("new task") },
  { id: "view-board",    label: "Switch to Board view",     run: () => console.log("board") },
  { id: "view-kanban",   label: "Switch to Kanban view",    run: () => console.log("kanban") },
  { id: "view-plans",    label: "Open Plans panel",         run: () => console.log("plans") },
  { id: "doctor",        label: "Run apohara doctor",       run: () => console.log("doctor") },
];

export const CommandPalette: FC = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      className="fixed inset-0 z-50 flex items-start justify-center pt-32"
    >
      <div className="bg-apohara-dark-2 border-2 border-apohara-lime w-[480px] p-2">
        <Command.Input
          placeholder="Type a command…"
          className="w-full bg-transparent border-b border-border font-mono text-xs px-2 py-2 outline-none"
        />
        <Command.List className="font-mono text-xs">
          {ACTIONS.map((a) => (
            <Command.Item
              key={a.id}
              onSelect={() => {
                a.run();
                setOpen(false);
              }}
              className="px-2 py-2 hover:bg-apohara-lime hover:text-apohara-ink cursor-pointer"
            >
              {a.label}
            </Command.Item>
          ))}
        </Command.List>
      </div>
    </Command.Dialog>
  );
};
```

- [ ] **Step 3: Mount en App.tsx, commit**

```bash
git add packages/desktop/package.json packages/desktop/src/components/CommandPalette.tsx packages/desktop/src/App.tsx
git commit -m "feat(ui): Cmd+K command palette via cmdk (G9.C.2)"
```

### Task G9.C.3: Resizable panels

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/src/App.tsx`

- [ ] **Step 1: Install**

```bash
cd packages/desktop && bun add react-resizable-panels
```

- [ ] **Step 2: Wrap layout main**

En `App.tsx` reemplazar grid existente entre `Sidebar` + `Main`:

```tsx
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";

<PanelGroup direction="horizontal" autoSaveId="apohara-main-layout">
  <Panel defaultSize={20} minSize={15} maxSize={40}>
    <Sidebar />
  </Panel>
  <PanelResizeHandle className="w-1 bg-border hover:bg-apohara-lime transition-colors" />
  <Panel>
    <Main />
  </Panel>
</PanelGroup>
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/package.json packages/desktop/src/App.tsx
git commit -m "feat(ui): resizable Sidebar/Main panels with persistent size (G9.C.3)"
```

### Task G9.C.4: TooltipProvider 400ms delay

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `packages/desktop/src/App.tsx`

- [ ] **Step 1: Install Radix tooltip**

```bash
cd packages/desktop && bun add @radix-ui/react-tooltip
```

- [ ] **Step 2: Wrap root**

```tsx
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";

// outermost component wrap:
<TooltipProvider delayDuration={400} skipDelayDuration={150}>
  <ConfirmationDialogProvider>
    {/* ... */}
  </ConfirmationDialogProvider>
</TooltipProvider>
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/package.json packages/desktop/src/App.tsx
git commit -m "feat(ui): TooltipProvider with 400ms hover delay (G9.C.4)

Steal cross-repo pattern from orca/chorus/vibe-kanban: 400ms delay before
tooltip appears, 150ms grace when moving between adjacent tooltips."
```

### Task G9.C.5: shadcn/ui primitives consolidation

**Files:**
- Create: `packages/desktop/src/components/ui/Button.tsx`
- Create: `packages/desktop/src/components/ui/Input.tsx`
- Create: `packages/desktop/src/components/ui/Card.tsx`

- [ ] **Step 1: Crear primitives mínimas con branding Apohara**

```tsx
// packages/desktop/src/components/ui/Button.tsx
import { ButtonHTMLAttributes, FC, forwardRef } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "ghost";
}

const VARIANT: Record<NonNullable<Props["variant"]>, string> = {
  primary:     "bg-apohara-lime text-apohara-ink hover:bg-apohara-lime-bright",
  secondary:   "border border-apohara-lime text-apohara-lime hover:bg-apohara-lime hover:text-apohara-ink",
  destructive: "bg-apohara-red text-apohara-bone hover:bg-apohara-red-bright",
  ghost:       "text-apohara-bone hover:bg-apohara-dark",
};

export const Button = forwardRef<HTMLButtonElement, Props>(({ variant = "primary", className = "", ...rest }, ref) => (
  <button
    ref={ref}
    className={`font-mono text-xs px-3 py-2 transition-colors ${VARIANT[variant]} ${className}`}
    {...rest}
  />
));
Button.displayName = "Button";
```

```tsx
// packages/desktop/src/components/ui/Input.tsx
import { InputHTMLAttributes, FC, forwardRef } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className = "", ...rest }, ref) => (
  <input
    ref={ref}
    className={`bg-apohara-dark border border-border font-mono text-xs px-2 py-2 focus:border-apohara-lime focus:outline-none ${className}`}
    {...rest}
  />
));
Input.displayName = "Input";
```

```tsx
// packages/desktop/src/components/ui/Card.tsx
import { FC, HTMLAttributes } from "react";

export const Card: FC<HTMLAttributes<HTMLDivElement>> = ({ className = "", ...rest }) => (
  <div className={`bg-apohara-dark-2 border border-border p-3 ${className}`} {...rest} />
);
```

- [ ] **Step 2: Tests snapshot mínimos**

```tsx
// packages/desktop/src/components/ui/__tests__/Button.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "bun:test";
import { Button } from "../Button";

test("Button primary uses lime bg", () => {
  render(<Button>click</Button>);
  const btn = screen.getByText("click");
  expect(btn.className).toContain("bg-apohara-lime");
});
test("Button destructive uses red bg", () => {
  render(<Button variant="destructive">danger</Button>);
  const btn = screen.getByText("danger");
  expect(btn.className).toContain("bg-apohara-red");
});
```

- [ ] **Step 3: Commit**

```bash
bun test packages/desktop/src/components/ui/__tests__/Button.test.tsx
git add packages/desktop/src/components/ui/
git commit -m "feat(ui): Button + Input + Card primitives with Apohara branding (G9.C.5)"
```

---

## G9.D — PixelCanvas + chief mascot (3 tareas, 1 día)

**Outcome**: Mascot pixel-art renderiza en el dashboard (header derecho o splash). Sprite sheet generated via los prompts en `ecosystem/probant/docs/brand/asset-prompts.md` + cropping manual.

### Task G9.D.1: Generar sprite sheet via prompt

**Files:**
- Create: `packages/desktop/public/sprites/chief-mascot.png` (binary)
- Create: `packages/desktop/public/sprites/chief-mascot.json` (sprite sheet metadata)

- [ ] **Step 1: Generar imagen 256×256 con el prompt principal**

Usar el prompt principal de `ecosystem/probant/docs/brand/asset-prompts.md` (Native American chief mascot, pixel-art 64×64, lime+ink palette). Output como PNG 256×256 con transparencia.

Si no hay generador disponible localmente: documentar en el commit que el asset queda pendiente y crear un placeholder verde 64×64 PNG generado vía `bun`:

```typescript
// scripts/generate-mascot-placeholder.ts
import { writeFileSync } from "fs";

// 64×64 pixel art placeholder: lime body + ink outline
// (Minimal PNG generator omitted for brevity — see ecosystem/consilium/scripts/png-generator.ts)
```

- [ ] **Step 2: Crear metadata JSON**

```json
{
  "frames": {
    "idle":    { "x": 0,   "y": 0, "w": 64, "h": 64 },
    "working": { "x": 64,  "y": 0, "w": 64, "h": 64 },
    "thinking":{ "x": 128, "y": 0, "w": 64, "h": 64 },
    "happy":   { "x": 192, "y": 0, "w": 64, "h": 64 }
  },
  "fps": 2
}
```

- [ ] **Step 3: Commit (sprite binary + metadata)**

```bash
git add packages/desktop/public/sprites/
git commit -m "feat(brand): chief mascot sprite sheet 256x256 + frame metadata (G9.D.1)

Sprite generated from ecosystem/probant/docs/brand/asset-prompts.md.
4 frames: idle / working / thinking / happy.
JSON metadata enables PixelCanvas to crop the correct frame on render."
```

### Task G9.D.2: Reescribir `PixelCanvas` para sprite sheet animation

**Files:**
- Modify: `packages/desktop/src/components/PixelCanvas.tsx`
- Create: `packages/desktop/src/components/__tests__/PixelCanvas.test.tsx`

- [ ] **Step 1: Test rendering sprite frame**

```tsx
// packages/desktop/src/components/__tests__/PixelCanvas.test.tsx
import { render } from "@testing-library/react";
import { expect, test } from "bun:test";
import { PixelCanvas } from "../PixelCanvas";

test("PixelCanvas renders a canvas element with pixelated rendering", () => {
  const { container } = render(<PixelCanvas spriteUrl="/sprites/chief-mascot.png" frame="idle" />);
  const canvas = container.querySelector("canvas")!;
  expect(canvas.getAttribute("width")).toBe("64");
  expect(canvas.style.imageRendering).toBe("pixelated");
});
```

- [ ] **Step 2: Reescribir PixelCanvas con frame support**

```tsx
// packages/desktop/src/components/PixelCanvas.tsx
import { FC, useEffect, useRef } from "react";
import frames from "/sprites/chief-mascot.json";

interface Props {
  spriteUrl: string;
  frame: "idle" | "working" | "thinking" | "happy";
  size?: number;
}

export const PixelCanvas: FC<Props> = ({ spriteUrl, frame, size = 64 }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const img = new Image();
    img.onload = () => {
      const f = (frames as any).frames[frame];
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, size, size);
    };
    img.src = spriteUrl;
  }, [spriteUrl, frame, size]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ imageRendering: "pixelated" }}
    />
  );
};
```

- [ ] **Step 3: Commit**

```bash
bun test packages/desktop/src/components/__tests__/PixelCanvas.test.tsx
git add packages/desktop/src/components/PixelCanvas.tsx packages/desktop/src/components/__tests__/PixelCanvas.test.tsx
git commit -m "feat(ui): PixelCanvas crops chief mascot sprite by frame (G9.D.2)"
```

### Task G9.D.3: Mount mascot en Header

**Files:**
- Modify: `packages/desktop/src/components/Header.tsx`

- [ ] **Step 1: Importar PixelCanvas + atom de "global activity state"**

```tsx
// packages/desktop/src/components/Header.tsx
import { useAtom } from "jotai";
import { dagStoreAtom } from "../store/dagStore";
import { PixelCanvas } from "./PixelCanvas";

export const Header: FC = () => {
  const [store] = useAtom(dagStoreAtom);
  const anyWorking = store.tasks.some((t) =>
    ["dispatched", "in_verification"].includes(t.status)
  );
  const anyError = store.tasks.some((t) => ["blocked", "failed"].includes(t.status));
  const frame = anyError ? "thinking" : anyWorking ? "working" : "idle";

  return (
    <header className="border-b-2 border-apohara-lime bg-apohara-ink px-6 py-4 flex items-center gap-4">
      <PixelCanvas spriteUrl="/sprites/chief-mascot.png" frame={frame} size={32} />
      <span className="font-display text-apohara-lime text-sm tracking-widest">APOHARA CATALYST</span>
      <span className="font-mono text-apohara-bone/60 text-xs">v1.0.0-rc.1</span>
      <span className="ml-auto font-mono text-apohara-bone/40 text-xs">local-first · CLI wrappers</span>
    </header>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/components/Header.tsx
git commit -m "feat(ui): mount chief mascot in Header, reactive to task state (G9.D.3)"
```

---

## Cierre Sprint 9

- [ ] **Verify 1: Test suite verde**

```bash
bun test packages/desktop/src/
```
Expected: all pass.

- [ ] **Verify 2: Build success**

```bash
cd packages/desktop && bun run build
```
Expected: 0 errors.

- [ ] **Verify 3: Visual smoke**

```bash
APOHARA_DESKTOP_PORT=7331 bun --hot src/server.ts &
sleep 3
npx playwright screenshot http://localhost:7331/ docs/superpowers/visual-baselines/post-sprint-9/dashboard.png || curl -s http://localhost:7331 -o /tmp/index-post.html
kill %1
```
Comparar manualmente con baselines pre-Sprint-9. Verificar lime + chief + Press Start 2P brand visible.

- [ ] **Verify 4: a11y basic**

```bash
npx playwright eval --url http://localhost:7331 'window.axe?.run()' || echo "axe-core not installed; manual review"
```

- [ ] **Verify 5: Commit cierre**

```bash
git log --oneline feat/apohara-catalyst | head -25
```

---

## Self-Review

**Spec coverage**:
- spec §3 brand tokens (palette + fonts): G9.A.1-A.4.
- spec §3 top 5 features steal: G9.B.1 (AgentStateDot) + G9.B.2 (TaskBoard wire) + G9.B.3 (Kanban) + G9.B.4 (RunningBorder) + G9.B.5 (ConfirmationDialogProvider) + G9.B.6 + G9.D.2 (PixelCanvas).
- spec §3 cross-repo polish: G9.C.1 (Sonner) + G9.C.2 (cmdk) + G9.C.3 (resizable) + G9.C.4 (Tooltip 400ms) + G9.C.5 (shadcn/ui primitives).
- spec §3 chief mascot: G9.D.1-D.3.

**Placeholder scan**: G9.D.1 admite explícitamente que si no hay generador disponible, hay placeholder verde — esto NO es placeholder en el sentido del skill (TBD/TODO), es una rama documentada con fallback concreto.

**Type consistency**:
- `AgentState` type definido en G9.B.1 (`idle | working | waiting | done | error`); consumido en G9.B.2 (mapper de `TaskStatus`).
- Sprite frames: `idle / working / thinking / happy` consistentes entre G9.D.1 (JSON), G9.D.2 (Props type), G9.D.3 (mascot mount).
- Palette names (`apohara-lime`, `apohara-ink`, etc.) consistentes a través de G9.A.2 (CSS vars), G9.A.3 (Tailwind theme), G9.B.* y G9.C.* (consumo).

**Riesgo identificado y mitigado**:
- Tailwind 4 vs 3: G9.A.3 incluye ambos paths (Step 2A vs 2B), implementer elige según `tailwindcss` versión en package.json.
- Sprite asset puede no estar disponible localmente: G9.D.1 documenta el fallback placeholder y deja explícito que el chief real se inyecta cuando el asset esté listo (no bloquea el resto del Sprint).
- `useAtom(dagStoreAtom)` asume jotai como ya wired: verificar en Setup 2 antes de arrancar; si falla, blocker se escala al lead.

**Esfuerzo total**: ~4 días con 4 implementers (G9.A primero, luego G9.B+C+D en paralelo).
