-- Schema v1 per spec §3.6.
-- Five core tables for durable orchestration state:
--   messages, tasks, dispatch_contexts, decision_gates, coordinator_runs.
-- CHECK constraints enforce enum-like columns at the SQLite layer.
-- IF NOT EXISTS makes apply idempotent (defense in depth — the
-- PRAGMA user_version gate in db.ts is the primary guard).

CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    from_handle   TEXT NOT NULL,
    to_handle     TEXT NOT NULL,
    subject       TEXT,
    body          TEXT,
    type          TEXT NOT NULL CHECK(type IN
      ('status','dispatch','worker_done','merge_ready','escalation','handoff','decision_gate','heartbeat')),
    priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK(priority IN ('urgent','normal','low')),
    thread_id     TEXT,
    payload       TEXT,
    read          INTEGER NOT NULL DEFAULT 0,
    delivered_at  INTEGER,
    ts            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_handle, read);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

CREATE TABLE IF NOT EXISTS tasks (
    id                          TEXT PRIMARY KEY,
    parent_id                   TEXT,
    created_by_terminal_handle  TEXT,
    spec                        TEXT NOT NULL,
    status                      TEXT NOT NULL CHECK(status IN
      ('pending','ready','dispatched','completed','failed','blocked')),
    deps                        TEXT NOT NULL DEFAULT '[]',
    result                      TEXT,
    completed_at                INTEGER,
    ts                          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS dispatch_contexts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL REFERENCES tasks(id),
    agent_handle  TEXT NOT NULL,
    worktree_id   TEXT,
    preamble      TEXT NOT NULL,
    status        TEXT NOT NULL CHECK(status IN ('spawning','running','completed','failed','aborted')),
    started_at    INTEGER NOT NULL,
    completed_at  INTEGER,
    ts            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_gates (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id_blocked   TEXT NOT NULL REFERENCES tasks(id),
    task_id_blocking  TEXT NOT NULL REFERENCES tasks(id),
    reason            TEXT NOT NULL,
    overlap_symbols   TEXT NOT NULL,
    status            TEXT NOT NULL CHECK(status IN ('open','resolved')),
    opened_at         INTEGER NOT NULL,
    resolved_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gates_blocking ON decision_gates(task_id_blocking, status);
CREATE INDEX IF NOT EXISTS idx_gates_blocked ON decision_gates(task_id_blocked, status);

CREATE TABLE IF NOT EXISTS coordinator_runs (
    id          TEXT PRIMARY KEY,
    run_id      TEXT NOT NULL,
    status      TEXT NOT NULL CHECK(status IN ('starting','running','completed','aborted')),
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER
);
