#!/usr/bin/env bash
# Apohara Catalyst — Arch / personal desktop install (Sprint 23, W5.1).
#
# Builds and installs the Dioxus desktop binary via cargo, exposes it on PATH
# as `apohara-catalyst`, and installs the KDE/GNOME .desktop launcher entry.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_PATH="$REPO_ROOT/crates/apohara-desktop-dioxus"
BIN_NAME="apohara-desktop-dioxus"
LINK_NAME="apohara-catalyst"
LOCAL_BIN="$HOME/.local/bin"
CARGO_BIN="${CARGO_HOME:-$HOME/.cargo}/bin"

echo "==> Installing $BIN_NAME (cargo install --path, release)"
cargo install --path "$CRATE_PATH" --force

# Expose the binary under the friendly name used by the .desktop entry.
mkdir -p "$LOCAL_BIN"
ln -sf "$CARGO_BIN/$BIN_NAME" "$LOCAL_BIN/$LINK_NAME"
echo "==> Symlinked $LOCAL_BIN/$LINK_NAME -> $CARGO_BIN/$BIN_NAME"

# R6: warn if ~/.local/bin is not on PATH (the symlink is useless otherwise).
case ":$PATH:" in
  *":$LOCAL_BIN:"*) ;;
  *)
    echo "WARNING: $LOCAL_BIN is not on your PATH."
    echo "         Add it so 'apohara-catalyst' resolves, e.g.:"
    echo "           echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
    ;;
esac

# Install the desktop launcher entry + icon (best effort).
DESKTOP_SRC="$REPO_ROOT/packaging/desktop/apohara-catalyst.desktop"
ICON_SRC="$REPO_ROOT/packaging/desktop/apohara-catalyst.png"
APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
if [ -f "$DESKTOP_SRC" ]; then
  mkdir -p "$APPS_DIR" "$ICON_DIR"
  install -m644 "$DESKTOP_SRC" "$APPS_DIR/apohara-catalyst.desktop"
  if [ -f "$ICON_SRC" ]; then
    install -m644 "$ICON_SRC" "$ICON_DIR/apohara-catalyst.png"
  fi
  # Refresh the menu cache if the tool is present.
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
  fi
  echo "==> Installed desktop entry to $APPS_DIR"
fi

echo "==> Done. Launch with 'apohara-catalyst' or from the KDE/GNOME menu."
