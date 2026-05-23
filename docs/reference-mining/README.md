# Reference mining — 194 hallazgos extraídos del análisis exhaustivo

> Persistencia de los reportes de análisis de 10 reference repos consultados durante
> la fase de brainstorming del spec Apohara v1.0. Los reportes están en su forma
> original (texto generado por los research agents), sin resumir.
>
> **Extracción:** 2026-05-22
> **Fuente:** transcript JSONL `2cca8063-3113-43cf-8e42-e6c5e8b578c3` + los subagent
> JSONLs anidados en `subagents/agent-<agentId>.jsonl` dentro de esa misma sesión.
> El transcript del orquestador solo contiene los stubs `Async agent launched
> successfully` retornados por la tool `Agent` async; los reportes completos viven
> en cada subagent JSONL como el último (y más grande) bloque `assistant text`.

## Resumen por repo

| Repo | Hallazgos esperados (Pablo) | Hallazgos extraídos | Match | Archivo |
|---|---:|---:|---|---|
| orca | 17 | 17 | OK | [orca.md](orca.md) |
| nimbalyst | 41 | 45* | + 4 dotted-subfindings | [nimbalyst.md](nimbalyst.md) |
| chorus | 19 | 19 | OK | [chorus.md](chorus.md) |
| culture | 15 | 15 | OK | [culture.md](culture.md) |
| claude-octopus | 17 | 17 | OK | [claude-octopus.md](claude-octopus.md) |
| symphony | 15 | 15 | OK | [symphony.md](symphony.md) |
| agentrail | 17 | 17 | OK | [agentrail.md](agentrail.md) |
| multica | 18 | 18 | OK (14 primarios + 4 secundarios) | [multica.md](multica.md) |
| vibe-kanban | 20 | 20 | OK | [vibe-kanban.md](vibe-kanban.md) |
| nimbalyst-landing | 15 | 15 | OK | [nimbalyst-landing.md](nimbalyst-landing.md) |
| **TOTAL** | **194** | **198** | — | — |

(*) Discrepancia source-side documentada abajo.

## Rondas de análisis

- **Ronda 1** (orca + nimbalyst) → 17 + 41 = **58 hallazgos**
- **Ronda 2** (chorus, culture, claude-octopus, symphony, agentrail, multica, vibe-kanban + landing nimbalyst.com)
  → 19 + 15 + 17 + 15 + 17 + 18 + 20 + 15 = **136 hallazgos**
- **Total agregado:** 58 + 136 = **194 hallazgos** (el conteo canónico que usó Pablo
  cuando dijo "Incorporar ABSOLUTAMENTE TODO con detalle completo" y el spec
  resultante quedó en `docs/superpowers/specs/2026-05-21-apohara-v1-design.md`).

## Discrepancias y notas

- **nimbalyst (45 vs 41):** El reporte estructurado tiene 45 entradas con header
  `### Hallazgo X.Y:` (12 categorías × varios sub-findings cada una), pero la línea
  final del propio reporte dice literalmente:
  `**Total: 41 hallazgos en 12 categorías.**`
  La discrepancia es source-side (el research agent contó mal su propio output);
  el contenido extraído es completo — los 45 sub-findings están todos presentes
  en `nimbalyst.md`. El conteo canónico de 41 es el que Pablo usó downstream para
  derivar 194 total.
- **multica (18):** El reporte tiene 14 hallazgos primarios numerados `## N.` y
  4 hallazgos secundarios numerados `**N.` (`**15.`, `**16.`, `**17.`, `**18.`).
  Suma 18, coincide con la expectativa.
- Ningún reporte parece truncado. Todos terminan con sección de resumen,
  priorización o recomendación explícita.
- No quedaron Agent dispatches pendientes — los 10 subagent JSONLs existen en
  disco y todos contienen un bloque final ≥ 14 KB con el reporte completo.

## Procedencia técnica

Los reportes fueron generados por research agents despachados con la tool
`Agent` (asincrónica) durante la sesión `2cca8063-...`. El orquestador les pidió
a cada uno "analizar EXHAUSTIVAMENTE el repo `<repo>/` y extraer las MÁXIMAS
inspiraciones posibles para Apohara". Los `agentId` que mapean a cada reporte:

| Repo | `agentId` |
|---|---|
| nimbalyst | `aba801b79fa944580` |
| orca | `ad9df7658e348c9c2` |
| chorus | `a02acc0e61f7c54e5` |
| culture | `a4301cf33d514595e` |
| claude-octopus | `ac2c950637b95e838` |
| symphony | `a01347d9cedaf6a94` |
| agentrail | `a06715a0f24aef281` |
| multica | `aa5153fe4bed0920d` |
| vibe-kanban | `aa7f4fd13944549d9` |
| nimbalyst-landing | `af1cf25c37f07ea24` |

Sus transcripts completos viven en:
`~/.claude/projects/-home-thelinconx-Documentos-Apohara-Ultimate/2cca8063-3113-43cf-8e42-e6c5e8b578c3/subagents/agent-<agentId>.jsonl`

## Estructura de los reportes

Cada `<repo>.md` contiene el bloque final `assistant text` del subagent
correspondiente, en bruto y sin reformatear. Sigue uno de varios formatos
(según la convención que eligió el research agent):

- **orca, nimbalyst, chorus, claude-octopus:** `### Hallazgo N:` o
  `### Hallazgo X.Y:`
- **culture, symphony, agentrail, vibe-kanban:** `### N.` (numeración plana)
- **multica:** `## N.` para 14 primarios + `**N.` para 4 secundarios
- **nimbalyst-landing:** `### Finding N`

Cada hallazgo, sin importar el formato, sigue la misma estructura interna:
**Qué / Dónde / Por qué inspira / Cómo traducir / Valor (ALTO/MEDIO/BAJO)**.

## Cómo usar estos archivos

Estos reportes son la **fuente de verdad de las decisiones** plasmadas en
`docs/superpowers/specs/2026-05-21-apohara-v1-design.md`. Si una decisión del
spec dice "inspirado en `culture #4`" o "patrón de `nimbalyst 6.1`", el detalle
de origen — incluyendo paths de los repos referenciados, código snippet, y
trade-offs — vive aquí.

Cada archivo está en el formato Markdown ya producido por su agente; no se
realizó edición, normalización ni traducción. Para auditar la trazabilidad
spec→hallazgo, abrir el `<repo>.md` correspondiente y buscar por el número de
hallazgo.
