//! Explicit per-(scope, resource) permission grid — ports
//! `src/core/safety/permissionGrid.ts` (chorus H10).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum PermissionScope {
    Once,
    Session,
    Always,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionState {
    Allow,
    Deny,
    Unset,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermissionRow {
    pub scope: PermissionScope,
    pub resource: String,
    pub state: PermissionState,
}

#[derive(Debug, Default)]
pub struct PermissionGrid {
    rows: HashMap<(PermissionScope, String), PermissionState>,
}

impl PermissionGrid {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&mut self, scope: PermissionScope, resource: &str, state: PermissionState) {
        if matches!(state, PermissionState::Unset) {
            self.rows.remove(&(scope, resource.to_string()));
        } else {
            self.rows.insert((scope, resource.to_string()), state);
        }
    }

    pub fn get(&self, scope: PermissionScope, resource: &str) -> PermissionState {
        self.rows
            .get(&(scope, resource.to_string()))
            .copied()
            .unwrap_or(PermissionState::Unset)
    }

    pub fn export_rows(&self) -> Vec<PermissionRow> {
        self.rows
            .iter()
            .map(|((scope, resource), state)| PermissionRow {
                scope: *scope,
                resource: resource.clone(),
                state: *state,
            })
            .collect()
    }
}
