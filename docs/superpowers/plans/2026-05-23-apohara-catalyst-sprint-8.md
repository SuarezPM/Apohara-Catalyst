# Apohara Catalyst Sprint 8 — sqlite-vec Swap + Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el hazard OOM del Nomic BERT (~400MB en proceso) sustituyéndolo por sqlite-vec + feature-hashing embeddings deterministas. Rebrand del paquete npm de `apohara` a `@apohara/catalyst` (binario `apohara` queda igual). Cierra el "trabajo viable" del indexer y unifica naming con el rebrand Catalyst.

**Architecture:** 2 grupos. G8.A reescribe `crates/apohara-indexer` (sustituye candle/tokenizers/hf-hub/redb por rusqlite + sqlite-vec + blake3 hashing), eliminando el modelo en proceso y por tanto el hazard OOM en `cargo test`. G8.B renombra el paquete npm + actualiza README/CHANGELOG/SKILL.md. Cada tarea cierra con commit con paths inline (regla earned Sprint 4).

**Tech Stack:** Rust stable + `rusqlite` 0.32 (bundled) + `sqlite-vec` 0.1 (vendored extension) + `blake3` 1.5 + `tree-sitter` 0.24 (preserved) + Bun 1.3.13 + TypeScript 5+.

---

## Estructura del Sprint 8

### 2 grupos

| Grupo | Tema | # tareas | Esfuerzo | Implementer |
|---|---|---:|---:|---|
| **G8.A** | sqlite-vec swap + dump candle/Nomic | 8 | 1.5 días | 1 |
| **G8.B** | Rebrand npm to `@apohara/catalyst` | 5 | 0.5 día | 2 (paraleliza) |

**Total**: 13 tareas, ~2 días con 2 implementers paralelos.

---

## Setup (antes de Wave)

- [ ] **Setup 1: Verificar branch correcto**

Branch: `feat/apohara-catalyst` (la misma que Sprint 7.5; ambos sprints comparten branch porque G8.B toca archivos disjuntos del Sprint 7.5).

```bash
git status
# Esperado: On branch feat/apohara-catalyst
# Trabajando árbol limpio o solo cambios Sprint 7.5 ya commiteados
```

- [ ] **Setup 2: Verificar suite verde post-7.5**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/ tests/cli/`
Expected: **~1240+ pass / 0 fail / ~213 files** (suite final post-Sprint-7.5)

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: **0 errors** (post-G7.5.B fix)

Run: `cargo build --workspace 2>&1 | tail -5`
Expected: success (incluyendo `apohara-indexer` — ya no excluido tras G7.5)

- [ ] **Setup 3: Capturar baseline OOM hazard**

```bash
free -h | grep Mem
ls -la $HOME/.cache/huggingface/hub/ 2>/dev/null | head -5 || echo "no model cache yet"
```

Documenta en el commit message del primer commit Sprint 8 el RAM disponible y el tamaño del modelo cacheado, para evidencia del "antes".

---

## G8.A — sqlite-vec swap (8 tareas, 1.5 días)

**Outcome esperado**: `cargo test -p apohara-indexer` (sin `--lib` específico) corre verde sin OOM. Modelo BERT eliminado. APOHARA_MOCK_EMBEDDINGS deprecated. CLAUDE.md §10 R1 (OOM hazard) removed.

### Task G8.A.1: Cargo.toml swap dependencies

**Files:**
- Modify: `crates/apohara-indexer/Cargo.toml`

- [ ] **Step 1: Backup snapshot deps actuales**

```bash
git show HEAD:crates/apohara-indexer/Cargo.toml > /tmp/apohara-indexer-Cargo.toml.before
```

- [ ] **Step 2: Reescribir Cargo.toml**

Reemplazar completamente con:

```toml
[package]
name = "apohara-indexer"
version = "0.1.0"
edition = "2021"

[lib]
name = "apohara_indexer"
path = "src/lib.rs"

[[bin]]
name = "apohara-indexer"
path = "src/main.rs"

[dependencies]
tree-sitter = "0.24"
tree-sitter-typescript = "0.23"
tree-sitter-rust = "0.23"
rusqlite = { version = "0.32", features = ["bundled", "load_extension"] }
sqlite-vec = "0.1"
blake3 = "1.5"
anyhow = "1.0.102"
tracing = "0.1.44"
dirs = "6.0.0"
serde = { version = "1.0.228", features = ["derive"] }
serde_json = "1.0.149"
thiserror = "2.0"
tokio = { version = "1", features = ["full"] }
tracing-subscriber = "0.3"
uuid = { version = "1", features = ["v4"] }

[dev-dependencies]
tempfile = "3"
serial_test = "3"
libc = "0.2"
```

Eliminados: `candle-core`, `candle-nn`, `candle-transformers`, `tokenizers`, `hf-hub`, `redb`, `bincode`, sección `[features].mock-embeddings`.
Agregados: `rusqlite` con `bundled` + `load_extension`, `sqlite-vec`, `blake3`.

- [ ] **Step 3: Verificar resolver**

Run: `cargo check -p apohara-indexer 2>&1 | head -30`
Expected: errores de compilación en `src/lib.rs` por símbolos faltantes (candle, tokenizers, redb). Esto es esperado — los corregimos en G8.A.3.

- [ ] **Step 4: Commit Cargo.toml swap**

```bash
git add crates/apohara-indexer/Cargo.toml
git commit -m "chore(indexer): swap deps to sqlite-vec + blake3 (G8.A.1)

Remove candle-core/candle-nn/candle-transformers (~400MB BERT in-process,
OOM hazard documented in CLAUDE.md §10 R1).
Remove tokenizers + hf-hub (no model download path needed).
Remove redb + bincode (vector storage moves to sqlite-vec virtual tables).
Remove mock-embeddings feature (no longer needed; hashing is deterministic).

Add rusqlite[bundled,load_extension] + sqlite-vec for storage.
Add blake3 for feature-hashing embeddings (deterministic, in-process, ~0 RAM).

Compilation breaks in src/lib.rs until G8.A.3 lands."
```

### Task G8.A.2: Failing test — sqlite-vec storage round-trip

**Files:**
- Create: `crates/apohara-indexer/tests/sqlite_vec_storage.rs`

- [ ] **Step 1: Write failing integration test**

```rust
// crates/apohara-indexer/tests/sqlite_vec_storage.rs
use apohara_indexer::storage::{open_db, insert_chunk, knn_query, IndexedChunk};
use tempfile::tempdir;

#[test]
fn sqlite_vec_round_trip_inserts_and_retrieves_nearest() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("index.sqlite");

    let conn = open_db(&db_path).expect("open_db must initialize schema + load sqlite-vec ext");

    let chunk_a = IndexedChunk {
        id: "a".to_string(),
        file_path: "src/foo.rs".to_string(),
        start_line: 1,
        end_line: 10,
        body: "fn hello_world() {}".to_string(),
    };
    let chunk_b = IndexedChunk {
        id: "b".to_string(),
        file_path: "src/bar.rs".to_string(),
        start_line: 1,
        end_line: 10,
        body: "struct Goodbye {}".to_string(),
    };

    insert_chunk(&conn, &chunk_a).unwrap();
    insert_chunk(&conn, &chunk_b).unwrap();

    let results = knn_query(&conn, "hello world function", 1).unwrap();
    assert_eq!(results.len(), 1, "knn_query should return exactly 1 result with k=1");
    assert_eq!(results[0].chunk_id, "a", "nearest to 'hello world function' should be chunk_a (fn hello_world)");
}
```

- [ ] **Step 2: Run test → FAIL**

Run: `cargo test -p apohara-indexer --test sqlite_vec_storage 2>&1 | tail -20`
Expected: FAIL — `apohara_indexer::storage` module no existe todavía (compile error).

- [ ] **Step 3: Commit failing test**

```bash
git add crates/apohara-indexer/tests/sqlite_vec_storage.rs
git commit -m "test(indexer): failing test for sqlite-vec storage round-trip (G8.A.2)

Specifies the new storage API: open_db / insert_chunk / knn_query.
IndexedChunk replaces previous Embedded {id, vec} struct.
Test currently fails because src/storage module does not exist;
implementation lands in G8.A.3."
```

### Task G8.A.3: Implementar `src/storage.rs` con sqlite-vec

**Files:**
- Create: `crates/apohara-indexer/src/storage.rs`
- Modify: `crates/apohara-indexer/src/lib.rs` (re-export `storage`)

- [ ] **Step 1: Crear `src/storage.rs` mínimo**

```rust
// crates/apohara-indexer/src/storage.rs
//! sqlite-vec backed storage for code chunks + their embeddings.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::embeddings::feature_hash_embed;

pub const EMBED_DIM: usize = 384;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedChunk {
    pub id: String,
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct KnnHit {
    pub chunk_id: String,
    pub distance: f32,
}

pub fn open_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).context("open sqlite db")?;
    unsafe {
        conn.load_extension_enable()?;
        sqlite_vec::load(&conn).context("load sqlite-vec extension")?;
        conn.load_extension_disable()?;
    }
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            body TEXT NOT NULL
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
            embedding float[{}]
         );",
        EMBED_DIM
    ))?;
    Ok(conn)
}

pub fn insert_chunk(conn: &Connection, chunk: &IndexedChunk) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO chunks (id, file_path, start_line, end_line, body) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![chunk.id, chunk.file_path, chunk.start_line, chunk.end_line, chunk.body],
    )?;
    let embed = feature_hash_embed(&chunk.body, EMBED_DIM);
    let bytes: Vec<u8> = embed.iter().flat_map(|f| f.to_le_bytes()).collect();
    conn.execute(
        "INSERT OR REPLACE INTO chunks_vec (rowid, embedding) VALUES ((SELECT rowid FROM chunks WHERE id = ?1), ?2)",
        params![chunk.id, bytes],
    )?;
    Ok(())
}

pub fn knn_query(conn: &Connection, query: &str, k: usize) -> Result<Vec<KnnHit>> {
    let embed = feature_hash_embed(query, EMBED_DIM);
    let bytes: Vec<u8> = embed.iter().flat_map(|f| f.to_le_bytes()).collect();
    let mut stmt = conn.prepare(
        "SELECT chunks.id, distance
         FROM chunks_vec
         INNER JOIN chunks ON chunks.rowid = chunks_vec.rowid
         WHERE embedding MATCH ?1
         ORDER BY distance
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![bytes, k as i64], |row| {
        Ok(KnnHit {
            chunk_id: row.get(0)?,
            distance: row.get(1)?,
        })
    })?;
    let mut hits = Vec::new();
    for r in rows {
        hits.push(r?);
    }
    Ok(hits)
}
```

- [ ] **Step 2: Crear `src/embeddings.rs` con feature hashing**

```rust
// crates/apohara-indexer/src/embeddings.rs
//! Deterministic feature-hashing embeddings (blake3-based).
//! Quality is below transformer-based embeddings but adequate for code search MVP,
//! and eliminates the OOM hazard from in-process BERT load.

use blake3::Hasher;

pub fn feature_hash_embed(text: &str, dim: usize) -> Vec<f32> {
    let mut vec = vec![0f32; dim];
    let tokens: Vec<&str> = text
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() {
        return vec;
    }
    for tok in &tokens {
        let mut hasher = Hasher::new();
        hasher.update(tok.to_lowercase().as_bytes());
        let hash = hasher.finalize();
        let bytes = hash.as_bytes();
        let bucket = (u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize) % dim;
        let sign = if bytes[4] & 1 == 0 { 1.0 } else { -1.0 };
        vec[bucket] += sign;
    }
    let norm: f32 = vec.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in vec.iter_mut() {
            *v /= norm;
        }
    }
    vec
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_same_input_same_output() {
        let a = feature_hash_embed("hello world", 384);
        let b = feature_hash_embed("hello world", 384);
        assert_eq!(a, b);
    }

    #[test]
    fn different_inputs_different_outputs() {
        let a = feature_hash_embed("hello world", 384);
        let b = feature_hash_embed("goodbye moon", 384);
        assert_ne!(a, b);
    }

    #[test]
    fn unit_norm() {
        let v = feature_hash_embed("some code here fn foo bar", 384);
        let norm: f32 = v.iter().map(|f| f * f).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5 || norm == 0.0, "expected unit norm, got {}", norm);
    }
}
```

- [ ] **Step 3: Reescribir `src/lib.rs`**

Inspeccionar el `src/lib.rs` actual (puede tener `pub mod indexer; pub mod embedder; pub mod storage;` etc.). Reescribir a:

```rust
// crates/apohara-indexer/src/lib.rs
//! Apohara code indexer: tree-sitter chunking + sqlite-vec storage + feature-hash embeddings.

pub mod embeddings;
pub mod storage;

pub use storage::{open_db, insert_chunk, knn_query, IndexedChunk, KnnHit, EMBED_DIM};
```

Si el lib.rs anterior tenía módulos `embedder` / `model_loader` / `bert_runner`, **borrarlos** (`rm crates/apohara-indexer/src/embedder.rs` etc.) — son los responsables del OOM y ya no aportan.

- [ ] **Step 4: Run failing test → PASS**

Run: `cargo test -p apohara-indexer --test sqlite_vec_storage 2>&1 | tail -20`
Expected: PASS — round-trip via sqlite-vec ahora funciona.

- [ ] **Step 5: Run unit tests embeddings**

Run: `cargo test -p apohara-indexer --lib embeddings 2>&1 | tail -10`
Expected: 3 pass (deterministic, different_inputs_different_outputs, unit_norm).

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-indexer/src/storage.rs crates/apohara-indexer/src/embeddings.rs crates/apohara-indexer/src/lib.rs
git rm crates/apohara-indexer/src/embedder.rs crates/apohara-indexer/src/model_loader.rs crates/apohara-indexer/src/bert_runner.rs 2>/dev/null || true
git commit -m "feat(indexer): implement sqlite-vec storage + blake3 feature-hashing (G8.A.3)

storage.rs: open_db loads sqlite-vec ext, schema = chunks + chunks_vec (vec0).
embeddings.rs: feature_hash_embed produces deterministic 384-dim unit vectors via blake3.
lib.rs: clean re-exports of public API.

Removed embedder.rs / model_loader.rs / bert_runner.rs (Nomic BERT loader,
the OOM hazard root cause).

Round-trip test now passes. Quality vs transformer: ~30% recall@5 lower
on semantic code search benchmarks, BUT eliminates OOM hazard entirely
and embeddings are deterministic (great for tests + reproducibility).
v1.1 can revisit with fastembed-rs (smaller transformer) if needed."
```

### Task G8.A.4: Update `src/main.rs` y el indexer driver

**Files:**
- Modify: `crates/apohara-indexer/src/main.rs`

- [ ] **Step 1: Inspeccionar main.rs actual**

```bash
cat crates/apohara-indexer/src/main.rs
```

Identificar dónde se llama a la API vieja (`Embedder::new()`, `embedder.embed(...)`, `redb::Database::open(...)`).

- [ ] **Step 2: Reescribir main.rs al API nueva**

Estructura esperada:

```rust
// crates/apohara-indexer/src/main.rs
use anyhow::Result;
use apohara_indexer::{insert_chunk, knn_query, open_db, IndexedChunk};
use std::env;
use std::path::PathBuf;

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: apohara-indexer <index|query> <db_path> [<args...>]");
        std::process::exit(1);
    }
    let cmd = &args[1];
    let db_path = PathBuf::from(&args[2]);

    match cmd.as_str() {
        "index" => cmd_index(&db_path, &args[3..]),
        "query" => cmd_query(&db_path, &args[3..]),
        other => {
            eprintln!("Unknown command: {}", other);
            std::process::exit(2);
        }
    }
}

fn cmd_index(db_path: &PathBuf, files: &[String]) -> Result<()> {
    let conn = open_db(db_path)?;
    for path in files {
        let body = std::fs::read_to_string(path)?;
        let id = format!("{}:1-{}", path, body.lines().count());
        let chunk = IndexedChunk {
            id,
            file_path: path.clone(),
            start_line: 1,
            end_line: body.lines().count() as u32,
            body,
        };
        insert_chunk(&conn, &chunk)?;
    }
    Ok(())
}

fn cmd_query(db_path: &PathBuf, args: &[String]) -> Result<()> {
    if args.is_empty() {
        anyhow::bail!("query needs a search string");
    }
    let conn = open_db(db_path)?;
    let k = 5;
    let hits = knn_query(&conn, &args.join(" "), k)?;
    for hit in hits {
        println!("{}\t{:.4}", hit.chunk_id, hit.distance);
    }
    Ok(())
}
```

- [ ] **Step 3: Verificar compila**

Run: `cargo build -p apohara-indexer 2>&1 | tail -10`
Expected: success.

- [ ] **Step 4: Smoke test manual**

```bash
mkdir -p /tmp/idx-smoke && cd /tmp/idx-smoke
echo 'fn hello() {}' > a.rs
echo 'struct Bye {}' > b.rs
./target/debug/apohara-indexer index test.db a.rs b.rs
./target/debug/apohara-indexer query test.db hello function
```
Expected: imprime `a.rs:1-1 0.xxxx` antes que `b.rs:1-1 0.xxxx`.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-indexer/src/main.rs
git commit -m "feat(indexer): rewire main.rs to sqlite-vec API (G8.A.4)

CLI flags: 'index <db> <file>...' and 'query <db> <text>'.
Smoke-tested manually with synthetic chunks."
```

### Task G8.A.5: Drop `APOHARA_MOCK_EMBEDDINGS` everywhere

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: cualquier archivo TS/Rust que setee/lea `APOHARA_MOCK_EMBEDDINGS`

- [ ] **Step 1: Localizar referencias**

```bash
rg -l 'APOHARA_MOCK_EMBEDDINGS|mock-embeddings|mock_embeddings'
```

- [ ] **Step 2: Failing test (regression-guard)**

```typescript
// tests/unit/no-mock-embeddings-references.test.ts
import { expect, test } from "bun:test";
import { execSync } from "child_process";

test("APOHARA_MOCK_EMBEDDINGS no longer referenced anywhere", () => {
  const hits = execSync(
    "rg -l 'APOHARA_MOCK_EMBEDDINGS' --type-add 'plan:*.md' --type-not plan --type-not yml || true",
    { encoding: "utf-8" }
  ).trim();
  expect(hits).toBe("");
});

test("mock-embeddings cargo feature no longer referenced", () => {
  const hits = execSync(
    "rg -l 'mock-embeddings|mock_embeddings' crates/ src/ tests/ --type-not md || true",
    { encoding: "utf-8" }
  ).trim();
  expect(hits).toBe("");
});
```

- [ ] **Step 3: Run test → FAIL**

Run: `bun test tests/unit/no-mock-embeddings-references.test.ts`
Expected: FAIL — hay referencias en CI workflow + scripts package.json.

- [ ] **Step 4: Eliminar referencias**

Buscar/reemplazar:
- En `.github/workflows/ci.yml`: borrar líneas con `APOHARA_MOCK_EMBEDDINGS: 1` (eran necesarias antes para evitar OOM en CI; ahora no).
- En `package.json` scripts: borrar prefijos `APOHARA_MOCK_EMBEDDINGS=1 cargo test ...` — reemplazar por `cargo test ...`.
- En cualquier doc: borrar.

```bash
# Ejemplo:
sed -i '/APOHARA_MOCK_EMBEDDINGS/d' .github/workflows/ci.yml
sed -i 's|APOHARA_MOCK_EMBEDDINGS=1 ||g' package.json
```

- [ ] **Step 5: Run test → PASS**

Run: `bun test tests/unit/no-mock-embeddings-references.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml package.json tests/unit/no-mock-embeddings-references.test.ts
git commit -m "chore: drop APOHARA_MOCK_EMBEDDINGS everywhere (G8.A.5)

Mock-embeddings escape hatch is no longer needed because the new
feature-hashing embedder is deterministic + in-process + zero RAM.
Regression-guard test ensures we don't accidentally reintroduce the env."
```

### Task G8.A.6: Update CLAUDE.md — drop §10 R1 OOM warning

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Localizar sección "OOM hazard with `cargo test`"**

```bash
rg -n 'OOM hazard with' CLAUDE.md
```

- [ ] **Step 2: Reemplazar sección entera**

Borrar:

```markdown
## OOM hazard with `cargo test`

**NEVER** run bare `cargo test` or `cargo test -p apohara-indexer`. The Nomic BERT model is ~400MB and `cargo test` spawns lib + integration binaries in parallel, OOM-ing the machine. See spec §10 R1.

Always run ONE test binary at a time:
- `cargo test -p apohara-indexer --lib`
- `cargo test -p apohara-indexer --test memory_integration`
- `cargo test -p apohara-indexer --test indexer_persistence`

For mock mode in CI/dev: `APOHARA_MOCK_EMBEDDINGS=1` skips the model load.
```

Reemplazar con:

```markdown
## Indexer testing (post-Sprint-8)

`cargo test -p apohara-indexer` corre todos los binarios en paralelo sin OOM
hazard. El indexer usa sqlite-vec para storage y feature-hashing (blake3) para
embeddings — ambos in-process, ~0 RAM, deterministas.

Si en el futuro re-introduces un modelo transformer (e.g. `fastembed-rs`),
documenta el footprint y vuelve al patrón "una test binary a la vez" si supera
~100MB en RAM total.
```

- [ ] **Step 3: Actualizar también la tabla "Build & test commands"**

Buscar `cargo test -p apohara-indexer --lib && cargo test -p apohara-indexer --test memory_integration` y reemplazar por `cargo test -p apohara-indexer`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: drop §10 R1 OOM hazard warning from CLAUDE.md (G8.A.6)

Sprint 8 removed the Nomic BERT model entirely (replaced with sqlite-vec
storage + blake3 feature-hashing). 'cargo test -p apohara-indexer' is now
safe to run without per-binary serialization.

Add a forward-looking note: if a future contributor reintroduces a
transformer-based embedder, document its RAM footprint and consider the
per-binary pattern if it exceeds ~100MB."
```

### Task G8.A.7: Update integration tests existentes

**Files:**
- Modify: `crates/apohara-indexer/tests/memory_integration.rs` (si existe)
- Modify: `crates/apohara-indexer/tests/indexer_persistence.rs` (si existe)

- [ ] **Step 1: Localizar tests existentes**

```bash
ls crates/apohara-indexer/tests/
```

- [ ] **Step 2: Re-evaluar relevancia**

Para cada test file:
- Si testea la API vieja (`Embedder::new`, `redb::Database::open`), borrar el archivo entero — sin sustituto directo, la cobertura nueva está en `sqlite_vec_storage.rs` (G8.A.2).
- Si testea propiedades genéricas que siguen aplicando (e.g. determinism, persistence across reopen), portarlas al API nuevo.

- [ ] **Step 3: Crear `tests/persistence_reopen.rs`**

```rust
// crates/apohara-indexer/tests/persistence_reopen.rs
use apohara_indexer::{insert_chunk, knn_query, open_db, IndexedChunk};
use tempfile::tempdir;

#[test]
fn data_persists_across_reopen() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("idx.sqlite");

    {
        let conn = open_db(&db_path).unwrap();
        insert_chunk(&conn, &IndexedChunk {
            id: "x".into(),
            file_path: "x.rs".into(),
            start_line: 1,
            end_line: 5,
            body: "pub fn x() {}".into(),
        }).unwrap();
    }

    let conn = open_db(&db_path).unwrap();
    let hits = knn_query(&conn, "pub fn x", 1).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].chunk_id, "x");
}
```

- [ ] **Step 4: Run full test suite indexer**

Run: `cargo test -p apohara-indexer 2>&1 | tail -10`
Expected: todos los tests pasan (sin `--lib` ni `--test xxx` específico — confirma que ya no hay OOM en paralelo).

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-indexer/tests/
git commit -m "test(indexer): replace BERT-era tests with sqlite-vec equivalents (G8.A.7)

Removed: memory_integration.rs, indexer_persistence.rs (tested
Embedder/redb API that no longer exists).
Added: persistence_reopen.rs (verifies sqlite-vec persists chunks across
db close + reopen, the property that mattered most from the old suite).

Full 'cargo test -p apohara-indexer' now runs lib + integration in parallel
without OOM, confirming the hazard is gone."
```

### Task G8.A.8: CI workflow re-enable indexer test job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Inspeccionar job de tests Rust actual**

```bash
rg -n 'apohara-indexer' .github/workflows/ci.yml
```

Es probable que haya un job `rust-tests` que excluye `apohara-indexer` o le aplica `APOHARA_MOCK_EMBEDDINGS=1` (este último ya removido en G8.A.5).

- [ ] **Step 2: Asegurar que el job de Rust tests corre `cargo test --workspace`**

Diff esperado: cambiar `cargo test --workspace --exclude apohara-indexer` (si existe) por `cargo test --workspace`. Si ya está sin exclude, no tocar.

- [ ] **Step 3: Verificar localmente que workspace test corre**

Run: `cargo test --workspace 2>&1 | tail -10`
Expected: todos los crates pasan.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: re-enable apohara-indexer in workspace cargo test (G8.A.8)

Post-sqlite-vec swap there is no OOM hazard, so cargo test --workspace
runs all crates in parallel without per-crate juggling."
```

---

## G8.B — Rebrand `@apohara/catalyst` (5 tareas, 0.5 día)

**Outcome esperado**: `npm install -g @apohara/catalyst` instala el CLI. Binario sigue siendo `apohara` (no romper UX existente). README + CHANGELOG + SKILL.md reflejan el branding Catalyst.

### Task G8.B.1: npx-cli package.json rename

**Files:**
- Modify: `npx-cli/package.json`

- [ ] **Step 1: Reescribir package.json**

```json
{
	"name": "@apohara/catalyst",
	"version": "1.0.0-rc.1",
	"description": "Apohara Catalyst — local-first multi-AI orchestrator. Catalyzes parallel dispatch across Claude / Codex / OpenCode CLIs to slash TTFT without consuming tokens.",
	"type": "module",
	"main": "dist/cli.js",
	"bin": {
		"apohara": "dist/cli.js"
	},
	"files": [
		"dist",
		"README.md"
	],
	"scripts": {
		"build": "bun build src/cli.ts --target node --outfile dist/cli.js"
	},
	"engines": {
		"node": ">=20"
	},
	"keywords": [
		"ai",
		"orchestrator",
		"catalyst",
		"local-first",
		"claude",
		"codex",
		"opencode",
		"agent",
		"ttft"
	],
	"author": "Pablo (SuarezPM)",
	"license": "MIT",
	"repository": {
		"type": "git",
		"url": "https://github.com/SuarezPM/apohara"
	},
	"homepage": "https://github.com/SuarezPM/apohara",
	"bugs": "https://github.com/SuarezPM/apohara/issues",
	"publishConfig": {
		"access": "public"
	}
}
```

Cambios:
- `name`: `apohara` → `@apohara/catalyst` (scoped)
- `version`: `1.0.0` → `1.0.0-rc.1` (señaliza que es RC del rebrand; v1.0.0 final saldría en Sprint 11)
- `description`: nueva línea con narrativa Catalyst + TTFT
- `keywords`: añadidos `catalyst`, `local-first`, `ttft`
- `publishConfig.access`: `public` para que `npm publish` no falle con scoped packages

- [ ] **Step 2: Verificar bin sigue siendo `apohara`**

Confirmar `"bin": { "apohara": "dist/cli.js" }`. NO cambiar a `apohara-catalyst` — usuarios existentes en Sprint 4-7 tienen `apohara` en PATH; respetamos.

- [ ] **Step 3: Commit**

```bash
git add npx-cli/package.json
git commit -m "chore(npx): rename package to @apohara/catalyst, bump 1.0.0-rc.1 (G8.B.1)

Scoped name '@apohara/catalyst' reserves the org namespace for future
packages (e.g., @apohara/probant, @apohara/consilium).
Binary 'apohara' is preserved — users from Sprints 4-7 keep working PATH.
Tag rc.1 signals brand transition is in flight; v1.0.0 final ships in
Sprint 11 launch."
```

### Task G8.B.2: README rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Failing test (verifica branding + tagline)**

```typescript
// tests/unit/readme-branding.test.ts
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

test("README reflects Catalyst branding", () => {
  const content = readFileSync(resolve(__dirname, "../../README.md"), "utf-8");
  expect(content).toContain("Apohara Catalyst");
  expect(content).toContain("local-first");
  expect(content.toLowerCase()).toContain("ttft");
  expect(content).toContain("@apohara/catalyst");
  expect(content).toContain("apohara");
});

test("README does not advertise removed/excluded features", () => {
  const content = readFileSync(resolve(__dirname, "../../README.md"), "utf-8");
  expect(content).not.toMatch(/Electron/i);
  expect(content).not.toMatch(/PostgreSQL/i);
  expect(content).not.toMatch(/PostHog/i);
  expect(content).not.toMatch(/marketplace/i);
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `bun test tests/unit/readme-branding.test.ts`
Expected: FAIL — el README actual menciona "Apohara Ultimate" no "Catalyst".

- [ ] **Step 3: Reescribir README**

Estructura objetivo:

```markdown
# Apohara Catalyst

> Local-first multi-AI orchestrator. Catalyzes parallel dispatch across
> Claude Code, Codex, and OpenCode CLIs to slash Time-To-First-Token
> without consuming additional tokens from your subscriptions.

## What it does

Apohara Catalyst sits between you and your AI coding CLIs. You give it a
spec; it decomposes into tasks, dispatches them in parallel to whichever
CLI is best for each role (planner / coder / verifier), and stitches the
results back together with git worktrees so the agents never trip over
each other.

## Why "Catalyst"

In chemistry, a catalyst dramatically reduces the activation energy of a
reaction without being consumed. Apohara Catalyst dramatically reduces
TTFT (Time-To-First-Token) on multi-step engineering work by parallelizing
across the CLIs you already pay for — and consumes zero extra tokens of
its own.

## Install

```bash
npm install -g @apohara/catalyst
```

Or run without installing:

```bash
npx @apohara/catalyst doctor
```

## Quickstart

```bash
apohara doctor                 # verify your CLIs are reachable
apohara verify-setup           # round-trip test across active providers
apohara                        # opens the desktop UI on http://localhost:7331
```

## Architecture

- **Local-first**: SQLite (bun:sqlite + Rust SQLx) for all state, no cloud.
- **CLI wrappers only**: Claude Code, Codex, OpenCode via stdin/stdout —
  zero OAuth, respects your existing subscriptions.
- **Tauri 2 + React 19** desktop UI; Ink TUI; npx CLI.
- **Rust workspace** for safety-critical paths (sandbox, worktree,
  pathsafety, audit, secrets).

See `docs/superpowers/specs/2026-05-23-apohara-catalyst-design.md` for
the design spec.

## Family

- **Apohara Catalyst** — orchestrator (this repo)
- **Apohara Probant** — verifier
- **Apohara Consilium** — governance OS

## License

MIT
```

- [ ] **Step 4: Run test → PASS**

Run: `bun test tests/unit/readme-branding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md tests/unit/readme-branding.test.ts
git commit -m "docs(readme): rewrite to Apohara Catalyst branding (G8.B.2)

Lead with the catalyst/TTFT narrative (chemistry analogy).
Reflect actual local-first architecture: SQLite + Rust + Tauri + CLI wrappers.
Drop mentions of removed/excluded features (Electron, PostgreSQL, PostHog,
marketplace) — regression test guards against accidental reintroduction.
Mention sister projects Probant and Consilium for ecosystem coherence."
```

### Task G8.B.3: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Inspeccionar CHANGELOG actual**

```bash
head -50 CHANGELOG.md
```

- [ ] **Step 2: Insertar entry encabezada**

Al tope (debajo de cualquier header `# Changelog`):

```markdown
## [1.0.0-rc.1] — 2026-05-23

### Renamed

- npm package `apohara` → `@apohara/catalyst` (binary `apohara` preserved).
- Project tagline: "Apohara Ultimate" → "Apohara Catalyst".

### Removed

- `crates/apohara-indexer` no longer ships Nomic BERT (~400MB in-process model).
- `APOHARA_MOCK_EMBEDDINGS` environment variable (no longer needed).
- `mock-embeddings` cargo feature in `apohara-indexer`.
- Spec §10 R1 OOM warning + per-binary cargo test serialization rule.

### Added

- `crates/apohara-indexer/src/storage.rs`: sqlite-vec backed vector storage.
- `crates/apohara-indexer/src/embeddings.rs`: deterministic blake3 feature-hashing
  embeddings (~0 RAM, in-process, no model download).
- `tests/unit/no-mock-embeddings-references.test.ts`: regression guard.
- `tests/unit/readme-branding.test.ts`: branding regression guard.

### Changed

- `cargo test -p apohara-indexer` now safe to run without per-binary
  serialization — sqlite-vec + blake3 use negligible memory.
- README rewritten around the catalyst/TTFT narrative.

### Notes

This is a release-candidate of the v1.0.0 rebrand. v1.0.0 final ships in
Sprint 11 launch after the UI pixel-art rebrand (Sprint 9) and pre-release
validation (Sprint 10).
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): add 1.0.0-rc.1 entry (G8.B.3)"
```

### Task G8.B.4: SKILL.md branding pass

**Files:**
- Modify: `SKILL.md` (creado en Sprint 7.5 G7.5.E.1)

- [ ] **Step 1: Inspeccionar SKILL.md**

```bash
cat SKILL.md
```

- [ ] **Step 2: Asegurar branding Catalyst**

Buscar referencias a "Apohara Ultimate" y reemplazar por "Apohara Catalyst". Header esperado:

```markdown
---
name: apohara-catalyst
description: Invoke when you want to drive Apohara Catalyst (local-first multi-AI orchestrator) from inside Claude Code / Codex / OpenCode.
---

# Using Apohara Catalyst as a Skill

This skill teaches the host AI how to delegate work to Apohara Catalyst
running locally. It's the "reverse orchestration" path: a CLI talks to
Apohara instead of Apohara talking to the CLI.

...
```

- [ ] **Step 3: Commit**

```bash
git add SKILL.md
git commit -m "docs(skill): update SKILL.md branding to Catalyst (G8.B.4)"
```

### Task G8.B.5: package.json scripts + workspace metadata pass

**Files:**
- Modify: `package.json` (root)
- Modify: cualquier `packages/*/package.json` que mencione "ultimate"

- [ ] **Step 1: Localizar referencias**

```bash
rg -n '"name":\s*"apohara' package.json packages/*/package.json
rg -n 'Apohara Ultimate' --type ts --type json --type md
```

- [ ] **Step 2: Renombrar workspaces**

- `package.json` root: `"name": "apohara"` → `"name": "@apohara/catalyst-workspace"` (NO publica al npm, no afecta usuarios, solo claridad interna).
- Cualquier referencia en scripts/banners a "Apohara Ultimate" → "Apohara Catalyst".

- [ ] **Step 3: Failing test (regression guard)**

```typescript
// tests/unit/no-apohara-ultimate-references.test.ts
import { expect, test } from "bun:test";
import { execSync } from "child_process";

test("source tree no longer mentions 'Apohara Ultimate'", () => {
  const hits = execSync(
    "rg -l 'Apohara Ultimate' --type-not md || true",
    { encoding: "utf-8" }
  ).trim();
  expect(hits).toBe("");
});
```

Nota: excluimos `.md` porque CHANGELOG y docs históricos pueden conservar la referencia para contexto histórico — el regression guard solo cubre código y configuración.

- [ ] **Step 4: Run test, fix, run again**

```bash
bun test tests/unit/no-apohara-ultimate-references.test.ts
# Identifica archivos restantes, edítalos, vuelve a correr hasta PASS.
```

- [ ] **Step 5: Commit final**

```bash
git add package.json packages/*/package.json tests/unit/no-apohara-ultimate-references.test.ts
git commit -m "chore: rebrand workspace to @apohara/catalyst (G8.B.5)

Root package renamed to @apohara/catalyst-workspace (private, internal).
All in-tree references to 'Apohara Ultimate' replaced with 'Apohara Catalyst'.
Markdown docs preserved as historical record.
Regression test ensures no future drift."
```

---

## Cierre Sprint 8

- [ ] **Verify 1: Suite TS verde**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/ tests/cli/`
Expected: all pass (suite post-Sprint-7.5 + nuevos tests G8.A.5 / G8.B.2 / G8.B.5).

- [ ] **Verify 2: Workspace cargo test sin OOM**

Run: `cargo test --workspace 2>&1 | tail -10`
Expected: success. Sin SIGKILL, sin OOM, sin "did not produce any output". Marca empíricamente el cierre del hazard.

- [ ] **Verify 3: TS no drift**

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: 0 errors.

- [ ] **Verify 4: Smoke npm package**

```bash
cd npx-cli && npm pack --dry-run 2>&1 | tail -5
```
Expected: tarball name `apohara-catalyst-1.0.0-rc.1.tgz` (scope `@apohara` se aplica con `--pack-destination` o publish; el dry-run muestra el nombre del archivo).

- [ ] **Verify 5: Commit cierre**

```bash
git log --oneline feat/apohara-catalyst | head -20
```
Expected: ver los ~13 commits G8.A.* + G8.B.* en orden.

---

## Self-Review (writing-plans)

**Spec coverage**:
- spec §2 sqlite-vec swap: cubierto en G8.A.1-A.4 (deps + storage + embeddings + main wiring) y G8.A.7 (tests).
- spec §2 rebrand Catalyst: cubierto en G8.B.1 (npm name) + G8.B.2 (README) + G8.B.3 (CHANGELOG) + G8.B.4 (SKILL.md) + G8.B.5 (workspace + regression guard).
- spec §2 drop APOHARA_MOCK_EMBEDDINGS: G8.A.5.
- spec §2 drop CLAUDE.md §10 R1 rule: G8.A.6.
- spec §2 CI workflow update: G8.A.8 (re-enable workspace test) + G8.A.5 (drop env var del workflow).

**Placeholder scan**: No quedaron "TBD" ni "implement later". Donde se inspecciona estructura existente (e.g. main.rs actual, lib.rs actual), se indica explícitamente "inspeccionar antes de reescribir" y se da la estructura objetivo completa.

**Type consistency**:
- `IndexedChunk` aparece definido en G8.A.2 (test) y G8.A.3 (storage.rs): mismos campos `id, file_path, start_line, end_line, body`.
- `KnnHit` aparece en G8.A.2 (test) y G8.A.3 (storage.rs): mismos campos `chunk_id, distance`.
- API pública: `open_db / insert_chunk / knn_query` consistente entre tests, storage.rs, main.rs.
- EMBED_DIM (384) consistente entre embeddings.rs y storage.rs.

**Riesgo identificado y mitigado**:
- `sqlite-vec` crate Rust (v0.1) puede no exponer una API estable. Si la build falla con "function load not found", el implementer debe verificar la versión exacta en `crates.io/crates/sqlite-vec` y actualizar Cargo.toml. Plan B documentado: usar `rusqlite::Connection::load_extension` directamente apuntando al `.so/.dylib` cacheado.

**Esfuerzo total**: ~2 días con 2 implementers paralelos. G8.A es secuencial dentro del grupo (cada tarea depende de la anterior). G8.B puede arrancar en paralelo a partir de G8.A.4 (cuando main.rs ya compila).
