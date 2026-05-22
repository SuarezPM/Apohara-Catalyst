#!/bin/bash
set -euo pipefail

name=$1
crate_dir="crates/$name"

mkdir -p "$crate_dir/src" "$crate_dir/tests"

cat > "$crate_dir/Cargo.toml" <<EOF
[package]
name = "$name"
edition.workspace = true
version.workspace = true
license.workspace = true
authors.workspace = true
repository.workspace = true

[dependencies]
serde.workspace = true
ts-rs.workspace = true
thiserror.workspace = true
tracing.workspace = true
EOF

cat > "$crate_dir/src/lib.rs" <<EOF
//! $name — see spec for purpose. Placeholder until Stage 2+ implementations.

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
EOF

cat > "$crate_dir/tests/smoke.rs" <<EOF
#[test]
fn version_is_non_empty() {
    assert!(!${name//-/_}::version().is_empty());
}
EOF

echo "Scaffolded $name at $crate_dir"
