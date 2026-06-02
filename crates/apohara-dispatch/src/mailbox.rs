//! Filesystem-backed mailbox for the BYOC mesh bus (US-F1.2).
//!
//! Blades are **separate OS processes** (claude / codex / opencode CLI
//! wrappers), so an in-process queue cannot carry a message from one blade
//! to another. This store gives each recipient a per-process-safe inbox on
//! disk that any blade can write to and the owner can drain — the storage
//! half of the F0.2 `send_message` / `check_inbox` mesh tools (the concrete
//! `MeshBackend` adapter that maps onto it is F1.4).
//!
//! Delivery is **poll-based**: a recipient calls [`Mailbox::check_inbox`] to
//! pull whatever has accumulated. There is no server push here — that, with
//! acknowledgements, is a later story (F2.3).
//!
//! The lock discipline is identical to [`crate::claim`]: a POSIX advisory
//! lock (`flock(2)` via [`fs2::FileExt`]) on a per-recipient `.lock` file
//! guards the read-modify-write of that recipient's queue, and persistence
//! uses the repo-wide atomic-write rule (§0.8) — `NamedTempFile` + `persist`
//! (tmp + rename), never an in-place truncating write a crash could leave
//! half-written. We reuse [`crate::claim::LockGuard`] rather than introduce a
//! second kind of lock.
//!
//! ## Drain-on-read tradeoff (read before building F2.3)
//!
//! [`Mailbox::check_inbox`] *drains*: it returns the pending messages and
//! atomically clears the queue, so each message is delivered exactly once
//! across concurrent polls. The cost is that if a poll result is lost in
//! transit (the caller crashes after the drain commits but before it
//! processes the messages), those messages are gone — there is no redelivery.
//! That is acceptable **only because poll is the BACKUP path**: F2.3 adds
//! push delivery plus acknowledgements as the reliable channel, and should
//! layer ack-before-clear semantics on top of this store rather than relying
//! on drain-on-read alone.

use crate::claim::LockGuard;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

/// A single mesh message, persisted in a recipient's inbox queue.
///
/// Structurally identical to `apohara-mcp`'s `MeshMessage` on the wire
/// (`from` / `to` / `body` / `ts`); the F1.4 adapter maps those fields with
/// no remapping. The `id` is local mailbox bookkeeping (US-F2.3): a stable
/// per-message handle so [`Mailbox::ack`] can remove *exactly* the messages a
/// push consumer confirmed, without touching ones that arrived since the
/// [`Mailbox::peek_inbox`]. Minted by [`Mailbox::send`] when empty, so callers
/// (and the wire-compatible `MeshMessage` conversion) need not supply it;
/// `serde(default)` keeps pre-F2.3 on-disk queues deserializable (their
/// messages get an empty id and are still drainable by `check_inbox`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    #[serde(default)]
    pub id: String,
    pub from: String,
    pub to: String,
    pub body: String,
    pub ts: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum MailboxError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Filesystem-backed mailbox. One directory holds every recipient's
/// `<recipient>.inbox.json` queue and `<recipient>.lock` companion. Cheap to
/// clone (just a path), so heterogeneous call sites can each construct their
/// own pointing at the same `root`.
#[derive(Debug, Clone)]
pub struct Mailbox {
    root: PathBuf,
}

impl Mailbox {
    /// Open (and lazily create) a mailbox rooted at `root`.
    ///
    /// Convention: pass `<workspace>/.apohara/mailbox`. The directory is
    /// created on demand on the first `send`, so this never touches disk.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn inbox_path(&self, recipient: &str) -> PathBuf {
        self.root.join(format!("{recipient}.inbox.json"))
    }

    fn lock_path(&self, recipient: &str) -> PathBuf {
        self.root.join(format!("{recipient}.lock"))
    }

    /// Open the per-recipient lock file, creating it if absent. The returned
    /// handle owns the advisory lock for as long as it is alive.
    fn open_lock(&self, recipient: &str) -> io::Result<File> {
        std::fs::create_dir_all(&self.root)?;
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.lock_path(recipient))
    }

    /// Enqueue `msg` for delivery. The queue locked is the **recipient's**
    /// (`msg.to`), not the sender's: a message lives in the inbox of whoever
    /// will drain it, so the lock must serialize against that recipient's
    /// concurrent `check_inbox` and other senders' `send`.
    pub fn send(&self, msg: Message) -> Result<(), MailboxError> {
        // Mint a stable id if the caller did not supply one, so ack (F2.3)
        // can later target this exact message. RFC 4122 v4 like the claim
        // token (`crate::state::fresh_claim_token`), reusing the existing
        // `uuid` dep rather than a sequence counter (which would need its own
        // locked persistence).
        let mut msg = msg;
        if msg.id.is_empty() {
            msg.id = uuid::Uuid::new_v4().to_string();
        }

        let lock = self.open_lock(&msg.to)?;
        // Block on purpose: a send is rare relative to a blade's work and must
        // land on the committed queue, so we serialize against an in-flight
        // drain rather than racing it (mirrors `claim::report_result`).
        lock.lock_exclusive()?;
        let _guard = LockGuard(&lock);

        let mut queue = self.load(&msg.to)?;
        // FIFO: append at the tail; `check_inbox` reads from the head.
        queue.push(msg.clone());
        self.persist(&msg.to, &queue)
    }

    /// Drain `recipient`'s inbox: return every pending message in FIFO order
    /// and atomically clear the queue so each message is delivered exactly
    /// once.
    ///
    /// We drain (rather than peek) under the lock for at-most-once delivery:
    /// holding the advisory lock across the read-and-clear makes the whole
    /// operation atomic, so two concurrent polls can never double-deliver or
    /// drop a message — the loser observes an already-emptied queue. See the
    /// module doc-comment for why losing an in-flight poll's payload is
    /// acceptable here (poll is the backup path; F2.3 owns reliable delivery).
    pub fn check_inbox(&self, recipient: &str) -> Result<Vec<Message>, MailboxError> {
        let lock = self.open_lock(recipient)?;
        lock.lock_exclusive()?;
        let _guard = LockGuard(&lock);

        let queue = self.load(recipient)?;
        if queue.is_empty() {
            // Nothing pending: leave the (possibly absent) file untouched so
            // an idle recipient never churns the disk.
            return Ok(queue);
        }
        // Clear before returning so the messages are gone the moment another
        // poll could observe them. Removing the file is the empty-queue
        // representation `load` already maps back to `Vec::new`, and it is the
        // atomic counterpart to `persist` (a single unlink, no torn write).
        self.clear(recipient)?;
        Ok(queue)
    }

    /// **Non-destructive** read of `recipient`'s inbox (US-F2.3 push path).
    ///
    /// Unlike [`Self::check_inbox`], this returns the pending messages WITHOUT
    /// clearing them — the reliable-delivery half of ack-before-clear. The
    /// server pushes these to the blade's hook-runtime; the messages stay on
    /// disk until the blade confirms reinjection via [`Self::ack`]. If the
    /// push is lost before the ack, nothing was cleared, so the poll fallback
    /// ([`Self::check_inbox`]) still delivers them — no message is stranded.
    ///
    /// Taken under the lock for a consistent snapshot against a concurrent
    /// `send`/`ack`/`check_inbox`.
    pub fn peek_inbox(&self, recipient: &str) -> Result<Vec<Message>, MailboxError> {
        let lock = self.open_lock(recipient)?;
        lock.lock_exclusive()?;
        let _guard = LockGuard(&lock);
        self.load(recipient)
    }

    /// Acknowledge delivery of specific messages by id, removing ONLY those
    /// from `recipient`'s queue (the clear half of ack-before-clear). Returns
    /// how many were removed. Messages that arrived after the corresponding
    /// [`Self::peek_inbox`] are preserved (their ids are not in `ids`), so a
    /// push consumer never drops a message it never saw.
    ///
    /// Idempotent: acking an id already gone is a no-op. Under the lock so the
    /// load-filter-persist is atomic against concurrent senders/pollers.
    pub fn ack(&self, recipient: &str, ids: &[String]) -> Result<usize, MailboxError> {
        let lock = self.open_lock(recipient)?;
        lock.lock_exclusive()?;
        let _guard = LockGuard(&lock);

        let queue = self.load(recipient)?;
        if queue.is_empty() {
            return Ok(0);
        }
        let ack_set: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
        let before = queue.len();
        let remaining: Vec<Message> = queue
            .into_iter()
            .filter(|m| !ack_set.contains(m.id.as_str()))
            .collect();
        let removed = before - remaining.len();
        if removed == 0 {
            return Ok(0);
        }
        if remaining.is_empty() {
            // Empty queue is represented as "no file" (see `load`); a single
            // unlink is the torn-write-free clear, matching `check_inbox`.
            self.clear(recipient)?;
        } else {
            self.persist(recipient, &remaining)?;
        }
        Ok(removed)
    }

    /// Read the current queue, or an empty `Vec` if this recipient has no
    /// inbox file yet. A missing file is the canonical empty-queue state, so
    /// `NotFound` is not an error.
    fn load(&self, recipient: &str) -> Result<Vec<Message>, MailboxError> {
        match std::fs::read(self.inbox_path(recipient)) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.into()),
        }
    }

    /// Atomic persist (§0.8): write the queue to a temp file in the same
    /// directory, then `persist()` (rename) over the target. A crash
    /// mid-write leaves the old queue intact instead of a truncated file.
    fn persist(&self, recipient: &str, queue: &[Message]) -> Result<(), MailboxError> {
        std::fs::create_dir_all(&self.root)?;
        let body = serde_json::to_vec_pretty(queue)?;
        let mut tmp = tempfile::NamedTempFile::new_in(&self.root)?;
        tmp.write_all(&body)?;
        tmp.flush()?;
        tmp.persist(self.inbox_path(recipient))
            .map_err(|e| MailboxError::Io(e.error))?;
        Ok(())
    }

    /// Atomically empty a recipient's queue by removing the inbox file. The
    /// empty state is "no file" (see `load`), so a single unlink is the
    /// torn-write-free way to clear it. A concurrent caller already removed
    /// it (`NotFound`) is fine — the post-condition (no pending messages)
    /// holds either way.
    fn clear(&self, recipient: &str) -> Result<(), MailboxError> {
        match std::fs::remove_file(self.inbox_path(recipient)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// `id`-free constructor: `send` mints the id, so tests assert on the
    /// content fields (`from`/`to`/`body`/`ts`) which ARE predictable.
    fn msg(from: &str, to: &str, body: &str, ts: i64) -> Message {
        Message {
            id: String::new(),
            from: from.to_string(),
            to: to.to_string(),
            body: body.to_string(),
            ts,
        }
    }

    /// Content projection (drops the minted id) for stable equality.
    fn bodies(msgs: &[Message]) -> Vec<&str> {
        msgs.iter().map(|m| m.body.as_str()).collect()
    }

    #[test]
    fn send_then_check_inbox_delivers() {
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());

        mailbox.send(msg("codex", "claude", "hi", 1)).unwrap();

        let received = mailbox.check_inbox("claude").unwrap();
        assert_eq!(bodies(&received), vec!["hi"]);
        assert_eq!(received[0].from, "codex");
        assert!(!received[0].id.is_empty(), "send must mint an id");
    }

    #[test]
    fn check_inbox_drains() {
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());

        mailbox.send(msg("codex", "claude", "hi", 1)).unwrap();

        // First poll delivers the message...
        let first = mailbox.check_inbox("claude").unwrap();
        assert_eq!(first.len(), 1);
        // ...the second sees an empty inbox (delivered exactly once).
        let second = mailbox.check_inbox("claude").unwrap();
        assert!(second.is_empty());
    }

    #[test]
    fn messages_preserve_fifo_order() {
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());

        mailbox.send(msg("codex", "claude", "first", 1)).unwrap();
        mailbox.send(msg("codex", "claude", "second", 2)).unwrap();

        let received = mailbox.check_inbox("claude").unwrap();
        assert_eq!(bodies(&received), vec!["first", "second"]);
    }

    #[test]
    fn recipients_are_isolated() {
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());

        mailbox.send(msg("codex", "claude", "for-claude", 1)).unwrap();

        // codex's inbox must not see a message addressed to claude.
        let codex_inbox = mailbox.check_inbox("codex").unwrap();
        assert!(codex_inbox.is_empty());

        // claude still has its message.
        let claude_inbox = mailbox.check_inbox("claude").unwrap();
        assert_eq!(bodies(&claude_inbox), vec!["for-claude"]);
    }

    // ---- US-F2.3 ack-before-clear (push path) ----

    #[test]
    fn peek_is_non_destructive() {
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());
        mailbox.send(msg("codex", "claude", "hi", 1)).unwrap();

        // Two peeks both see the message — peek never drains.
        assert_eq!(bodies(&mailbox.peek_inbox("claude").unwrap()), vec!["hi"]);
        assert_eq!(bodies(&mailbox.peek_inbox("claude").unwrap()), vec!["hi"]);
    }

    #[test]
    fn ack_removes_only_named_ids() {
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());
        mailbox.send(msg("codex", "claude", "first", 1)).unwrap();
        mailbox.send(msg("codex", "claude", "second", 2)).unwrap();

        let pending = mailbox.peek_inbox("claude").unwrap();
        let first_id = pending[0].id.clone();

        // Ack only the first; the second must remain.
        let removed = mailbox.ack("claude", &[first_id]).unwrap();
        assert_eq!(removed, 1);
        assert_eq!(bodies(&mailbox.peek_inbox("claude").unwrap()), vec!["second"]);

        // Acking an already-gone id is a no-op.
        assert_eq!(mailbox.ack("claude", &["nope".to_string()]).unwrap(), 0);
    }

    #[test]
    fn push_peek_then_ack_delivers_exactly_once() {
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());
        mailbox.send(msg("codex", "claude", "hi", 1)).unwrap();

        // Push path: peek (deliver) then ack (clear after confirmation).
        let pushed = mailbox.peek_inbox("claude").unwrap();
        assert_eq!(pushed.len(), 1);
        mailbox
            .ack("claude", &[pushed[0].id.clone()])
            .unwrap();

        // After ack, the message is gone for poll too — delivered once.
        assert!(mailbox.check_inbox("claude").unwrap().is_empty());
    }

    #[test]
    fn push_lost_before_ack_falls_back_to_poll() {
        // THE F2.3 reliability invariant: if the push is lost between peek and
        // ack (consumer crashes/never confirms), the message is NOT cleared,
        // so the permanent poll fallback (check_inbox) still delivers it.
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());
        mailbox.send(msg("codex", "claude", "important", 1)).unwrap();

        // Push delivered via peek, but the ack never arrives (lost push).
        let _pushed = mailbox.peek_inbox("claude").unwrap();
        // ...no ack...

        // Poll fallback still finds the message — nothing stranded.
        let polled = mailbox.check_inbox("claude").unwrap();
        assert_eq!(bodies(&polled), vec!["important"], "lost push must not strand the message");
    }
}
