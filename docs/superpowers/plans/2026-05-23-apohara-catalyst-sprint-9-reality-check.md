# Sprint 9 — Reality Check & Scope Decision

> Escrito durante la ejecución autónoma post-Sprint-8 cierre.
> Esperando decisión de Pablo antes de arrancar G9.

## Lo que el plan original asumió

El plan en `2026-05-23-apohara-catalyst-sprint-9.md` (escrito durante la fase writing-plans) asumió la siguiente stack ya instalada en `packages/desktop`:

- **Tailwind 4** (CSS-first config con `@theme`)
- **@hello-pangea/dnd** (Kanban drag-and-drop, robo de vibe-kanban)
- **cmdk** (Cmd+K palette)
- **sonner** (toasts)
- **@radix-ui/react-tooltip**, **@radix-ui/react-dialog** (primitives)
- **react-resizable-panels** (Sidebar/Main split)
- **framer-motion** (no en el plan pero implícito para animaciones)

## Lo que el desktop tiene realmente

Inspección a `packages/desktop/package.json` (HEAD `89b756c`):

```json
"dependencies": {
  "@monaco-editor/react": "^4.6.0",
  "@xterm/addon-fit": "^0.11.0",
  "@xterm/xterm": "^6.0.0",
  "@xyflow/react": "^12.5.0",
  "node-pty": "^1.1.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "xterm": "^5.3.0"
}
```

Root `package.json` añade `jotai`, `chokidar`, `commander`, `zod`, `yaml`, `vitest`. Cero Tailwind, cero Radix, cero shadcn.

`packages/desktop/src/index.css` (556 LOC) define una paleta cyan/violet dark theme con CSS vars + clases utilitarias custom. Comentario header: *"Apohara visual identity per Roadmap v2.0 M017.7"* — palette legacy heredada.

Componentes existentes (`packages/desktop/src/components/*`):

| Existe | Plan asumió |
|---|---|
| `HeroBanner.tsx` | `Header.tsx` |
| `PermissionDialog.tsx` (inline styles) | esperaba primitives Radix |
| `Statusline.tsx`, `CostMeter.tsx`, etc. | esperaba shadcn primitives |
| `SwarmCanvas.tsx` (@xyflow/react) | esperaba PixelCanvas raw |
| `TaskBoard/TaskBoard.tsx` | esperaba Kanban con dnd |
| `ViewToggle.tsx` | mention en plan, existe |

## Magnitud del refactor implícito

Para ejecutar el plan literalmente:

1. **Instalar 8+ libs** (Tailwind 4 + 7 más). Bundle size +~200MB en `node_modules`.
2. **Setup Tailwind 4** (CSS-first config). Requiere reescribir `index.css` para usar `@theme`.
3. **Migrar ~20 componentes** existentes de inline-styles + CSS classes custom a Tailwind utility classes. PermissionDialog (que ya tiene tokens Apohara post-Sprint-7.5), Statusline, CostMeter, HeroBanner, etc.
4. **Construir 5 nuevos componentes** desde cero con las libs (AgentStateDot, KanbanBoard, RunningBorder, ConfirmationDialogProvider, PixelCanvas+mascot).
5. **Polish layer**: Sonner toasts wire, cmdk Cmd+K, resizable panels, TooltipProvider.

Esfuerzo realista: 5-8 días con 4 implementers (vs los 4 días estimados en el plan).

## Opciones para decidir

### Opción A — Full execution del plan (alta inversión)

Instalar todo, refactor masivo, ~5-8 días subagent-driven autónomo. Pros: alineación total con la visión Catalyst que firmaste en brainstorming. Contras: bundle size, riesgo de regresiones en componentes existentes, tiempo.

### Opción B — Sprint 9 narrow (palette + fonts + mascot)

Solo lo que NO requiere libs nuevas:
- Reemplazar paleta cyan/violet → lime/dark/bone/ink/red Apohara en `index.css`
- Instalar `@fontsource/press-start-2p`, `@fontsource/jetbrains-mono`, `@fontsource/inter`
- Actualizar HeroBanner.tsx con "APOHARA CATALYST" + font-display
- Crear PixelCanvas.tsx (raw `<canvas>`, no dep extra) + mascot sprite placeholder
- Update CSS vars consumidas por componentes existentes (sin refactor)

Esfuerzo: ~0.5 día. Resultado visible pero menos ambicioso que la visión brainstorming.

### Opción C — Sprint 9 medio (palette + fonts + 2-3 features steal)

Opción B + instalación selectiva de las 2 features más impactantes:
- `@hello-pangea/dnd` para Kanban (single dep)
- `sonner` para toasts (single dep)
- Saltear cmdk, Radix, framer-motion, resizable-panels

Esfuerzo: ~1.5 días. Compromiso pragmático.

### Opción D — Pivot scope: solo brand + diferir features a v1.1

Brand pass únicamente (Opción B), Top 5 features y polish se posponen para v1.1.x. Permite que Sprint 10 + Sprint 11 corran sobre brand actualizada sin bloquear release.

## Mi recomendación

**Opción C** — pragmático. Captura la rebrand visual (paleta + fonts + mascot) que ES el corazón de la "Apohara Catalyst" identidad, suma 2 features de alto impacto (Kanban dnd + Sonner toasts ambos muy usados), salta lo más ambicioso de refactor.

Razones:
1. El brand pass es lo que más cambia la *percepción* del producto. PixelCanvas mascot reactivo + lime + Press Start 2P = la identidad visual Catalyst.
2. Kanban dnd + Sonner son features de UX moderna que el usuario va a notar inmediatamente sin requerir refactor de la mayoría de componentes.
3. cmdk Cmd+K + Radix primitives + framer-motion son polish que aporta menos por dólar de esfuerzo. Quedan listos en plan para v1.1.x.
4. Sprint 10 (pre-release validation) no se atrasa mucho.
5. Tu visión de "Catalyst" sigue vigente — solo postponemos detalles, no abandonamos.

## Status real al momento de escribir esto

- ✅ Sprint 7.5 cleanup (commit `27c6668`)
- ✅ Sprint 8 sqlite-vec + rebrand npm (commit `89b756c`)
- ⏳ Sprint 9 esperando tu decisión (A/B/C/D)
- ⏳ Sprint 10 listo en plan pero no arrancado (no afectado por la decisión de S9)
- ⏳ Sprint 11 listo en plan pero no ejecutable sin tu sign-off

Tests TS: 1297 pass / 0 fail / 226 files. Cargo workspace verde (2 sandbox e2e ignored por CachyOS kernel). TSC clean. npm pack dry-run OK.

Cuando vuelvas decímalo (A/B/C/D u otra opción) y procedo.
