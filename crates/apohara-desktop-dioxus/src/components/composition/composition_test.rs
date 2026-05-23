//! SSR tests for composition components (G2.C.3).
//!
//! Each component lands one-by-one under TDD: a failing test goes in first,
//! the real impl replaces the stub, and the test flips green before commit.

#![allow(unused_imports)]

use super::{
    ContextLevel, KanbanBoard, KanbanTask, KanbanTaskStatus, ObjectiveMode, ObjectivePane,
    Statusline, StatuslineState, ViewMode, ViewToggle,
};
use dioxus::prelude::*;
