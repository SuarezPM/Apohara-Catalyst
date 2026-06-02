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
/// Structurally identical to `apohara-mcp`'s `MeshMessage` so the F1.4
/// adapter converts between them field-for-field (`from` / `to` / `body` /
/// `ts`) with no remapping.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
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

    fn msg(from: &str, to: &str, body: &str, ts: i64) -> Message {
        Message {
            from: from.to_string(),
            to: to.to_string(),
            body: body.to_string(),
            ts,
        }
    }

    #[test]
    fn send_then_check_inbox_delivers() {
        let tmp = TempDir::new().unwrap();
        let mailbox = Mailbox::new(tmp.path());

        mailbox.send(msg("codex", "claude", "hi", 1)).unwrap();

        let received = mailbox.check_inbox("claude").unwrap();
        assert_eq!(received, vec![msg("codex", "claude", "hi", 1)]);
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
        assert_eq!(
            received,
            vec![
                msg("codex", "claude", "first", 1),
                msg("codex", "claude", "second", 2),
            ]
        );
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
        assert_eq!(claude_inbox, vec![msg("codex", "claude", "for-claude", 1)]);
    }
}
