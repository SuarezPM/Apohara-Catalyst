//! Brand effect components — Sprint 17 G2.B.2 ports of the React originals
//! in `packages/desktop/src/components/{AgentStateDot,RunningBorder,PixelCanvas}.tsx`.

pub mod agent_state_dot;
pub mod running_border;

pub use agent_state_dot::AgentStateDot;
pub use running_border::RunningBorder;

#[cfg(test)]
mod brand_test;
