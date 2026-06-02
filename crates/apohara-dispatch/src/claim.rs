//! Atomic task claim with a *real* advisory file lock (US-F0.0).
//!
//! This is the de-risking core of the BYOC ("bring your own CLI") model:
//! blades are **separate OS processes** (heterogeneous CLI wrappers —
//! claude / codex / opencode), so an in-process mutex cannot prevent two
//! of them from claiming the same task. We need cross-process mutual
//! exclusion that survives a process crash.
//!
//! Two layers cooperate:
//!   1. A POSIX advisory lock (`flock(2)` via [`fs2::FileExt`]) on a
//!      per-task `.lock` file. `try_lock_exclusive` is **non-blocking**:
//!      exactly one contender acquires it; every other gets a clean
//!      "already claimed" instead of blocking or panicking. The kernel
//!      drops the lock automatically if the holder dies, so a crashed
//!      claimer never deadlocks the task.
//!   2. A persisted claim record (`<task_id>.json`) holding the current
//!      [`RunState`] + claim token. The lock guards the read-modify-write
//!      of this record so the `Unclaimed → Claimed` transition (and its
//!      [`fresh_claim_token`]) is atomic against concurrent claimers.
//!
//! The claim token (RFC 4122 v4, via [`fresh_claim_token`]) closes the
//! reaper race: a blade reaped for being stalled may wake up later and
//! try to `report_result`. If the task was re-claimed in the meantime,
//! the zombie presents a stale token and is rejected — its result never
//! overwrites the live claimer's work.
//!
//! State persistence uses the repo-wide atomic-write discipline (§0.8):
//! `NamedTempFile::new_in(parent)` + `persist()` (tmp + rename), never an
//! in-place truncating write that a crash could leave half-written.

use crate::state::{can_transition, fresh_claim_token, RunState};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Liveness proof a claimer periodically renews so the reaper can tell a
/// slow-but-alive blade from a dead one. `pid` lets the reaper cross-check
/// against the OS process table; `last_beat_ms` extends the staleness
/// deadline past the original claim time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Heartbeat {
    pub pid: u32,
    pub last_beat_ms: i64,
    /// The holder process's start-time (Linux: `/proc/<pid>/stat` field 22,
    /// clock-ticks since boot), captured when the heartbeat was minted. The
    /// reaper compares it against the *current* start-time of `pid` so a
    /// **recycled PID** — a new, unrelated process the OS handed the same
    /// number after the blade died — is not mistaken for the live blade
    /// (US-F2.1 PID-reuse hardening). `None` for heartbeats minted without a
    /// start-time (older records, non-Linux); the reaper then trusts mere
    /// PID existence. Additive + `serde(default)` for backward-compatible
    /// deserialization.
    #[serde(default)]
    pub pid_start_time: Option<u64>,
}

/// Persisted claim record for a single task. Serialized to
/// `<root>/<task_id>.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClaimRecord {
    pub task_id: String,
    pub state: RunState,
    /// `Some` while the task is actively claimed (`Claimed`/`Running`);
    /// `None` once released so a stale token can never match a free slot.
    pub token: Option<String>,
    /// Epoch ms when the live claim was minted. Seeds the reaper's TTL
    /// deadline so a claimer that never beats still ages out. Additive +
    /// `serde(default)` so pre-existing records (and F0.0 tests) that omit
    /// it still deserialize as `None`.
    #[serde(default)]
    pub claimed_at_ms: Option<i64>,
    /// Latest renewed liveness proof, or `None` if the claimer has not
    /// beaten yet. Additive + `serde(default)` for backward-compatible
    /// deserialization.
    #[serde(default)]
    pub heartbeat: Option<Heartbeat>,
}

/// Wall-clock epoch millis. `std::time` only — no extra dependency. A
/// pre-epoch clock (impossible in practice) folds to 0 rather than
/// panicking.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Outcome of a [`ClaimStore::try_claim`] attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimOutcome {
    /// This caller won the race; carry the fresh token forward to
    /// [`ClaimStore::report_result`].
    Acquired { token: String },
    /// Another claimer holds the task. Clean signal — not an error.
    AlreadyClaimed,
}

/// Outcome of a [`ClaimStore::report_result`] call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReportOutcome {
    /// Token matched the live claim; the result is authoritative.
    Accepted,
    /// Token did not match (stale/reaped claimer) — result rejected so a
    /// zombie cannot overwrite the current claimer's outcome.
    StaleToken,
}

#[derive(Debug, thiserror::Error)]
pub enum ClaimError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    /// The persisted record exists but its state forbids the requested
    /// transition (corrupt store or logic bug, not normal contention).
    #[error("illegal transition for {task_id}: {from:?} -> {to:?}")]
    IllegalTransition {
        task_id: String,
        from: RunState,
        to: RunState,
    },
}

/// Filesystem-backed claim store. One directory holds every task's
/// `.json` record and `.lock` companion. Cheap to clone (just a path),
/// so heterogeneous call sites can each construct their own pointing at
/// the same `root`.
#[derive(Debug, Clone)]
pub struct ClaimStore {
    root: PathBuf,
}

impl ClaimStore {
    /// Open (and lazily create) a claim store rooted at `root`.
    ///
    /// Convention: pass `<workspace>/.apohara/claims`. The directory is
    /// created on demand on the first claim, so this never touches disk.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn record_path(&self, task_id: &str) -> PathBuf {
        self.root.join(format!("{task_id}.json"))
    }

    fn lock_path(&self, task_id: &str) -> PathBuf {
        self.root.join(format!("{task_id}.lock"))
    }

    /// Open the per-task lock file, creating it if absent. The returned
    /// handle owns the advisory lock for as long as it is alive.
    fn open_lock(&self, task_id: &str) -> io::Result<File> {
        std::fs::create_dir_all(&self.root)?;
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.lock_path(task_id))
    }

    /// Attempt to claim `task_id`. Cross-process atomic: under a barrier
    /// of N contenders, exactly one returns [`ClaimOutcome::Acquired`];
    /// the rest return [`ClaimOutcome::AlreadyClaimed`].
    ///
    /// The advisory lock is held only for the read-modify-write window —
    /// long enough to make the `Unclaimed → Claimed` flip + token mint
    /// atomic, then dropped. The *claim itself* is protected by the
    /// persisted state + token, not by holding the flock for the task's
    /// whole lifetime (which would die with the process and is the wrong
    /// granularity for long agent runs).
    pub fn try_claim(&self, task_id: &str) -> Result<ClaimOutcome, ClaimError> {
        let lock = self.open_lock(task_id)?;
        // Non-blocking: the loser does NOT wait — it gets WouldBlock and
        // we translate that into a clean AlreadyClaimed.
        match lock.try_lock_exclusive() {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                return Ok(ClaimOutcome::AlreadyClaimed);
            }
            Err(e) => return Err(e.into()),
        }
        // `lock` (and thus the flock) is released when this scope ends,
        // including every early return below.
        let _guard = LockGuard(&lock);

        let current = self.load(task_id)?;
        let from = current.as_ref().map(|r| r.state).unwrap_or(RunState::Unclaimed);

        // Only Unclaimed/Released slots are claimable; anything else is a
        // live claim held by someone who beat us to the persisted write.
        if from != RunState::Unclaimed && from != RunState::Released {
            return Ok(ClaimOutcome::AlreadyClaimed);
        }
        // Released must re-enter via Unclaimed per the state DAG; treat a
        // released slot as freshly claimable.
        let to = RunState::Claimed;
        let effective_from = if from == RunState::Released {
            RunState::Unclaimed
        } else {
            from
        };
        if !can_transition(effective_from, to) {
            return Err(ClaimError::IllegalTransition {
                task_id: task_id.to_string(),
                from: effective_from,
                to,
            });
        }

        let token = fresh_claim_token();
        let record = ClaimRecord {
            task_id: task_id.to_string(),
            state: RunState::Claimed,
            token: Some(token.clone()),
            // Stamp the mint time so the reaper can TTL-expire a claimer
            // that dies before ever sending a heartbeat.
            claimed_at_ms: Some(now_ms()),
            heartbeat: None,
        };
        self.persist(&record)?;
        Ok(ClaimOutcome::Acquired { token })
    }

    /// Renew the liveness proof for an active claim. Validates `token`
    /// against the *current* persisted claim under the advisory lock (same
    /// read-modify-write discipline as [`Self::report_result`]). On a token
    /// match the heartbeat is refreshed and the claim state is preserved;
    /// a stale token (the claimer was reaped and re-claimed) is rejected so
    /// a zombie cannot resurrect a slot it no longer owns.
    pub fn heartbeat(
        &self,
        task_id: &str,
        token: &str,
        pid: u32,
        now_ms: i64,
        pid_start_time: Option<u64>,
    ) -> Result<ReportOutcome, ClaimError> {
        let lock = self.open_lock(task_id)?;
        // Block on purpose, mirroring report_result: the heartbeat must
        // observe the committed claim, not race an in-flight one.
        lock.lock_exclusive()?;
        let _guard = LockGuard(&lock);

        let current = self.load(task_id)?;
        match current {
            Some(record) if record.token.as_deref() == Some(token) => {
                let beaten = ClaimRecord {
                    heartbeat: Some(Heartbeat {
                        pid,
                        last_beat_ms: now_ms,
                        pid_start_time,
                    }),
                    ..record
                };
                self.persist(&beaten)?;
                Ok(ReportOutcome::Accepted)
            }
            // Missing record, no live token, or a mismatched token: the
            // claim this caller thinks it holds is gone.
            _ => Ok(ReportOutcome::StaleToken),
        }
    }

    /// Report a result against the claim identified by `token`.
    ///
    /// Validates `token` against the *current* persisted claim under the
    /// advisory lock. A stale token (the claimer was reaped and the task
    /// re-claimed under a new token) is rejected. On acceptance the task
    /// transitions to `Released` and the token is cleared.
    pub fn report_result(
        &self,
        task_id: &str,
        token: &str,
    ) -> Result<ReportOutcome, ClaimError> {
        let lock = self.open_lock(task_id)?;
        // Block here on purpose: report is rare and must observe the
        // committed state, so we serialize against an in-flight claim
        // rather than racing it. (Distinct from `try_claim`, which must
        // never block a contender.)
        lock.lock_exclusive()?;
        let _guard = LockGuard(&lock);

        let current = self.load(task_id)?;
        match current {
            Some(record) if record.token.as_deref() == Some(token) => {
                let released = ClaimRecord {
                    task_id: task_id.to_string(),
                    state: RunState::Released,
                    token: None,
                    // Released slots carry no liveness metadata — a freed
                    // slot must never look like a live claim to the reaper.
                    claimed_at_ms: None,
                    heartbeat: None,
                };
                self.persist(&released)?;
                Ok(ReportOutcome::Accepted)
            }
            // Missing record, no live token, or a mismatched token: the
            // claim this caller thinks it holds is gone.
            _ => Ok(ReportOutcome::StaleToken),
        }
    }

    /// Release a claim out-of-band (e.g. a reaper freeing a stalled
    /// blade) so the slot becomes claimable again. Does not validate a
    /// token — the reaper acts on behalf of the system, not the claimer.
    pub fn release(&self, task_id: &str) -> Result<(), ClaimError> {
        let lock = self.open_lock(task_id)?;
        lock.lock_exclusive()?;
        let _guard = LockGuard(&lock);

        let released = ClaimRecord {
            task_id: task_id.to_string(),
            state: RunState::Released,
            token: None,
            // See report_result: a freed slot drops all liveness metadata.
            claimed_at_ms: None,
            heartbeat: None,
        };
        self.persist(&released)
    }

    /// Release `task_id` **only if it is still stale when re-checked under
    /// the advisory lock** — the TOCTOU-safe reaper primitive (US-F2.1).
    ///
    /// The standalone reaper used to decide staleness from a lock-free read
    /// and then call [`Self::release`] unconditionally. A heartbeat that
    /// landed in that window (a slow-but-alive blade) was reaped anyway,
    /// throwing away live work. This method closes that window: it takes the
    /// same lock the claimer's [`Self::heartbeat`] takes, **re-reads** the
    /// committed record, re-evaluates staleness against it, and releases only
    /// if it is *still* stale. Returns `true` iff it released.
    ///
    /// `is_alive(pid, pid_start_time)` is the injected liveness probe (the
    /// production one is [`crate::task_graph::default_pid_alive`]); passing
    /// the recorded start-time lets it reject a recycled PID.
    pub fn release_if_still_stale<F>(
        &self,
        task_id: &str,
        now_ms: i64,
        ttl_ms: i64,
        is_alive: &F,
    ) -> Result<bool, ClaimError>
    where
        F: Fn(u32, Option<u64>) -> bool,
    {
        let lock = self.open_lock(task_id)?;
        lock.lock_exclusive()?;
        let _guard = LockGuard(&lock);

        // Re-read the COMMITTED record under the lock. A heartbeat that
        // raced the caller's lock-free decision is visible here, so the
        // staleness verdict is authoritative.
        let Some(record) = self.load(task_id)? else {
            return Ok(false);
        };
        if !claim_is_stale(&record, now_ms, ttl_ms, is_alive) {
            return Ok(false);
        }

        let released = ClaimRecord {
            task_id: task_id.to_string(),
            state: RunState::Released,
            token: None,
            claimed_at_ms: None,
            heartbeat: None,
        };
        self.persist(&released)?;
        Ok(true)
    }

    /// Enumerate every persisted claim record under `root`, sorted by
    /// `task_id` for a deterministic order.
    ///
    /// Lock-free, like [`Self::load`] — this is an observability read (the
    /// desktop `claim_watcher` rescans the whole dir on every fs event,
    /// US-F1.5). A never-created store is *empty*, not an error, so a
    /// `NotFound` on the directory folds to `Ok(vec![])`.
    ///
    /// Only `<task_id>.json` records are read; the `.lock` companions and
    /// any in-flight `NamedTempFile` (the atomic-write tmp, §0.8) are
    /// skipped — the tmp has a random non-`.json` name, so the suffix
    /// filter excludes it without racing the rename.
    pub fn list(&self) -> Result<Vec<ClaimRecord>, ClaimError> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut records = Vec::new();
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            // Suffix filter, not filename match: only the JSON records, never
            // the `.lock` companion or the random-named atomic-write tmp.
            if !name.ends_with(".json") {
                continue;
            }
            let task_id = &name[..name.len() - ".json".len()];
            if let Some(record) = self.load(task_id)? {
                records.push(record);
            }
        }
        records.sort_by(|a, b| a.task_id.cmp(&b.task_id));
        Ok(records)
    }

    /// True iff `task_id` currently holds an active claim — i.e. a record
    /// exists in state [`RunState::Claimed`] or [`RunState::Running`].
    ///
    /// Lock-free, like [`Self::load`] (which it delegates to): this is the
    /// read side that the PreToolUse claim-guard hook (US-F2.0c) consults
    /// before allowing a blade's file write. A `Released`/`Unclaimed`/missing
    /// record is *not* an active claim, so the guard blocks the write. The
    /// hook treats this as a backstop only — the F2.0b prompt that instructs
    /// blades to claim first is the primary mitigation.
    pub fn has_active_claim(&self, task_id: &str) -> Result<bool, ClaimError> {
        Ok(matches!(
            self.load(task_id)?,
            Some(ClaimRecord {
                state: RunState::Claimed | RunState::Running,
                ..
            })
        ))
    }

    /// Read the current claim record, or `None` if the task was never
    /// claimed. Lock-free reads are fine for observability; the
    /// authoritative read-modify-write paths hold the lock.
    pub fn load(&self, task_id: &str) -> Result<Option<ClaimRecord>, ClaimError> {
        match std::fs::read(self.record_path(task_id)) {
            Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Atomic persist (§0.8): write to a temp file in the same directory,
    /// then `persist()` (rename) over the target. A crash mid-write
    /// leaves the old record intact instead of a truncated file.
    fn persist(&self, record: &ClaimRecord) -> Result<(), ClaimError> {
        std::fs::create_dir_all(&self.root)?;
        let body = serde_json::to_vec_pretty(record)?;
        let mut tmp = tempfile::NamedTempFile::new_in(&self.root)?;
        tmp.write_all(&body)?;
        tmp.flush()?;
        tmp.persist(self.record_path(&record.task_id))
            .map_err(|e| ClaimError::Io(e.error))?;
        Ok(())
    }
}

/// The single source of truth for "is this claim stale?", shared by the
/// reaper ([`crate::task_graph::reap_stale_claims`]) and the TOCTOU-safe
/// [`ClaimStore::release_if_still_stale`] so both decide identically.
///
/// A record is stale iff it is a *live* claim (`Claimed`/`Running`) whose
/// liveness has lapsed by **either** signal:
///   * **TTL expiry** — `now_ms` is past `max(claimed_at_ms,
///     heartbeat.last_beat_ms) + ttl_ms`. `saturating_add` keeps a
///     corrupt/hostile far-future timestamp from wrapping (it simply never
///     TTL-expires, staying PID-reapable).
///   * **dead PID** — a heartbeat is present and `is_alive(pid,
///     pid_start_time)` is false (gone, or the PID was recycled).
///
/// Edge case — a live (`Claimed`/`Running`) record with NEITHER
/// `claimed_at_ms` NOR a heartbeat: `last_seen` folds to 0, so the deadline
/// is just `ttl_ms` and any real wall-clock `now_ms` is past it → reaped on
/// sight. This only arises for a hand-written/legacy record predating the
/// `claimed_at_ms` field, since [`ClaimStore::try_claim`] always stamps it.
/// The direction is intentional and safe: a provenance-less claim is freed
/// rather than left stranding the slot forever.
pub(crate) fn claim_is_stale<F>(
    record: &ClaimRecord,
    now_ms: i64,
    ttl_ms: i64,
    is_alive: &F,
) -> bool
where
    F: Fn(u32, Option<u64>) -> bool,
{
    if !matches!(record.state, RunState::Claimed | RunState::Running) {
        return false;
    }
    let last_seen = record
        .claimed_at_ms
        .into_iter()
        .chain(record.heartbeat.as_ref().map(|h| h.last_beat_ms))
        .max()
        .unwrap_or(0);
    let deadline = last_seen.saturating_add(ttl_ms);
    // strict >: stale only *after* the deadline, not at it.
    let ttl_expired = now_ms > deadline;
    let pid_dead = record
        .heartbeat
        .as_ref()
        .map(|h| !is_alive(h.pid, h.pid_start_time))
        .unwrap_or(false);
    ttl_expired || pid_dead
}

/// Releases the advisory lock when dropped. `fs2`'s lock is tied to the
/// fd, so an explicit guard makes the release point unambiguous even
/// across early returns. `pub(crate)` so sibling stores (e.g. the F1.2
/// mailbox) reuse the *same* advisory-lock discipline instead of growing a
/// second kind of lock.
pub(crate) struct LockGuard<'a>(pub(crate) &'a File);

impl Drop for LockGuard<'_> {
    fn drop(&mut self) {
        // Best-effort: if unlock fails the fd close on `File` drop still
        // releases the flock, so there is nothing actionable to do here.
        let _ = fs2::FileExt::unlock(self.0);
    }
}
