//! Length-prefixed JSON framing for the local-socket transport.
//!
//! Frame format: `u32 BE length || JSON-encoded Envelope`. Max frame size is
//! capped to defend against malicious peers (length-prefix bomb).
//!
//! Reader rejects oversized frames and propagates io errors cleanly. Writer is
//! single-shot per envelope and flushes after each write.

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use thiserror::Error;

use super::envelope::{Envelope, EnvelopeError};

/// 16 MiB ceiling — generous for any realistic event but cheap enough to
/// reject malicious 4 GiB lengths immediately.
pub const MAX_FRAME_BYTES: u32 = 16 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum LocalSocketError {
    #[error("frame size {0} exceeds MAX_FRAME_BYTES ({MAX_FRAME_BYTES})")]
    FrameTooLarge(u32),
    #[error("frame envelope error: {0}")]
    Envelope(#[from] EnvelopeError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("connection closed mid-frame after {0} bytes")]
    UnexpectedEof(usize),
}

/// Write `envelope` framed as `u32 BE length || body`.
pub async fn write_frame<W>(w: &mut W, envelope: &Envelope) -> Result<(), LocalSocketError>
where
    W: AsyncWrite + Unpin,
{
    envelope.validate()?;
    let body = envelope.to_bytes()?;
    if body.len() as u64 > MAX_FRAME_BYTES as u64 {
        return Err(LocalSocketError::FrameTooLarge(body.len() as u32));
    }
    let len = (body.len() as u32).to_be_bytes();
    w.write_all(&len).await?;
    w.write_all(&body).await?;
    w.flush().await?;
    Ok(())
}

/// Read one framed envelope from `r`. Returns `Ok(None)` on clean EOF before
/// any bytes were read.
pub async fn read_frame<R>(r: &mut R) -> Result<Option<Envelope>, LocalSocketError>
where
    R: AsyncRead + Unpin,
{
    let mut len_buf = [0u8; 4];
    match r.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(LocalSocketError::Io(e)),
    }
    let len = u32::from_be_bytes(len_buf);
    if len > MAX_FRAME_BYTES {
        return Err(LocalSocketError::FrameTooLarge(len));
    }
    let mut body = vec![0u8; len as usize];
    match r.read_exact(&mut body).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(LocalSocketError::UnexpectedEof(len as usize));
        }
        Err(e) => return Err(LocalSocketError::Io(e)),
    }
    let env = Envelope::from_slice(&body)?;
    Ok(Some(env))
}
