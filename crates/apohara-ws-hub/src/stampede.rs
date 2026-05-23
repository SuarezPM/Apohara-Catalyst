//! Stampede control policy (G6.A.6).
//!
//! Caps how many concurrent subscribers can listen on a single channel, so a
//! flood of clients doesn't multiply the broadcast cost. Default is generous
//! for normal use but bounded so a misbehaving client can't fan out forever.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StampedePolicy {
    /// Max concurrent subscribers per channel/event. The 33th would be
    /// rejected with `HubError::StampedeCapReached`.
    pub max_subscribers_per_event: usize,
}

impl Default for StampedePolicy {
    fn default() -> Self {
        Self {
            max_subscribers_per_event: 32,
        }
    }
}

impl StampedePolicy {
    pub fn with_max(max: usize) -> Self {
        Self {
            max_subscribers_per_event: max.max(1),
        }
    }
}
