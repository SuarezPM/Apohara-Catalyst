#!/usr/bin/env sh
# Apohara installer — Phase 6.6
#
# Detects OS + arch, downloads the matching desktop binary from the
# GitHub release, places it in $PREFIX/bin, and `chmod +x`s it. Designed
# to be invoked via:
#
#     curl -fsSL https://raw.githubusercontent.com/SuarezPM/Apohara/main/scripts/install.sh | sh
#
# Override knobs (env vars):
#   APOHARA_VERSION    — release tag to install (default: latest)
#   APOHARA_PREFIX     — install root (default: /usr/local; auto-falls
#                        back to ~/.local when /usr/local isn't writable)
#   APOHARA_REPO       — owner/repo (default: SuarezPM/Apohara)
#
# Exit codes:
#   0   success
#   1   unsupported os/arch
#   2   download failed
#   3   no writable bin directory
#   4   required command missing (curl + tar)

set -eu

REPO="${APOHARA_REPO:-SuarezPM/Apohara}"
VERSION="${APOHARA_VERSION:-latest}"
PREFIX="${APOHARA_PREFIX:-${HOME}/.local}"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'error: %s is required but not installed.\n' "$1" >&2
    exit 4
  fi
}

require curl
require uname

OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "$OS_RAW" in
  Linux)   OS="linux" ;;
  Darwin)  OS="darwin" ;;
  MINGW*|MSYS*|CYGWIN*)
    printf 'error: Windows is not supported by install.sh.\n' >&2
    printf 'Download the MSI installer from https://github.com/%s/releases.\n' "$REPO" >&2
    exit 1
    ;;
  *)
    printf 'error: unsupported OS: %s\n' "$OS_RAW" >&2
    exit 1
    ;;
esac

case "$ARCH_RAW" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    printf 'error: unsupported arch: %s\n' "$ARCH_RAW" >&2
    exit 1
    ;;
esac

PLATFORM="${OS}-${ARCH}"

if [ "$VERSION" = "latest" ]; then
  printf 'Resolving latest version from GitHub...\n'
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
    | head -n 1)"
  if [ -z "$VERSION" ]; then
    printf 'error: could not resolve latest release tag.\n' >&2
    printf 'Set APOHARA_VERSION=vX.Y.Z explicitly.\n' >&2
    exit 2
  fi
fi

# TODO release-time: desktop-release.yml currently uploads the bare
# apohara-desktop binary. If a future release ships a tar.gz instead,
# switch ASSET to "apohara-desktop-${PLATFORM}.tar.gz" and uncomment
# the SHA256 block below.
ASSET="apohara-desktop"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
CHECKSUM_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}.sha256"

# Pick an install directory we can actually write to.
BIN_DIR="${PREFIX}/bin"
if [ ! -w "$PREFIX" ] && [ ! -w "$BIN_DIR" ]; then
  if [ "$PREFIX" = "/usr/local" ]; then
    printf 'Falling back to ~/.local (no write access to /usr/local).\n'
    PREFIX="${HOME}/.local"
    BIN_DIR="${PREFIX}/bin"
  fi
fi
mkdir -p "$BIN_DIR" 2>/dev/null || {
  printf 'error: could not create install directory %s.\n' "$BIN_DIR" >&2
  exit 3
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

printf 'Downloading %s\n' "$URL"
if ! curl -fL --progress-bar "$URL" -o "$TMP_DIR/${ASSET}"; then
  printf 'error: download failed.\n' >&2
  exit 2
fi

# TODO release-time: If the release ships a SHA256 sidecar, uncomment
# the block below once desktop-release.yml is updated to upload it.
# printf 'Verifying SHA256...\n'
# EXPECTED_SHA="$(curl -fsSL "$CHECKSUM_URL" | cut -d' ' -f1)"
# ACTUAL_SHA="$(sha256sum "$TMP_DIR/${ASSET}" | cut -d' ' -f1)"
# if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
#   printf 'error: SHA256 mismatch.\n' >&2
#   exit 2
# fi

install -m 0755 "$TMP_DIR/${ASSET}" "$BIN_DIR/apohara"
printf '\nInstalled apohara %s to %s\n' "$VERSION" "$BIN_DIR/apohara"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    printf '\nNote: %s is not on your PATH.\n' "$BIN_DIR"
    printf 'Add this to your shell rc:\n\n'
    printf '    export PATH="%s:$PATH"\n\n' "$BIN_DIR"
    ;;
esac

printf '\nRun "apohara doctor" to verify your setup.\n'
printf 'Run "apohara verify-setup" for an end-to-end check.\n'
