//! Permission prompt state — replaces `packages/desktop/src/store/permissionStore.ts`.
//!
//! The TS side carried two atoms keyed by `request_id`:
//!   - `pendingPermissionRequestsAtom`  — active prompts
//!   - `permissionResponsesAtom`        — resolved decisions
//!
//! Plus a derived `unresolvedPermissionRequestsAtom`. The Dioxus side
//! keeps the same split inside one signal (`PermissionState`) so reads
//! see a consistent snapshot and the derived view is a simple method.

use dioxus::prelude::*;
use std::collections::HashMap;

/// Scope chosen by the user when responding to a permission prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionScope {
    Once,
    Session,
    Always,
}

/// Decision attached to a `PermissionResponseEvent`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionDecision {
    Allow,
    Deny,
}

/// Inbound prompt from the agent-hooks server.
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRequestEvent {
    pub request_id: String,
    pub tool: String,
    pub suggested_pattern: String,
    pub available_scopes: Vec<PermissionScope>,
    pub ts: u64,
}

/// User reply pushed back to the agent-hooks server.
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionResponseEvent {
    pub request_id: String,
    pub decision: PermissionDecision,
    pub scope: Option<PermissionScope>,
    pub pattern: Option<String>,
    pub ts: u64,
}

/// Combined view: pending requests + recorded responses.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PermissionState {
    pub pending: HashMap<String, PermissionRequestEvent>,
    pub responses: HashMap<String, PermissionResponseEvent>,
}

/// Root signal owning both maps so reads see a consistent snapshot.
pub static PERMISSIONS: GlobalSignal<PermissionState> =
    Signal::global(PermissionState::default);

/// Add an incoming prompt to the pending queue.
pub fn enqueue_permission_request(req: PermissionRequestEvent) {
    PERMISSIONS
        .write()
        .pending
        .insert(req.request_id.clone(), req);
}

/// Record the user's decision. The pending entry stays — the UI uses
/// the response map to decide whether to render the prompt.
pub fn record_permission_response(resp: PermissionResponseEvent) {
    PERMISSIONS
        .write()
        .responses
        .insert(resp.request_id.clone(), resp);
}

/// Derived view: requests that have NOT yet received a response.
pub fn unresolved_requests() -> Vec<PermissionRequestEvent> {
    let state = PERMISSIONS.read();
    state
        .pending
        .values()
        .filter(|r| !state.responses.contains_key(&r.request_id))
        .cloned()
        .collect()
}
