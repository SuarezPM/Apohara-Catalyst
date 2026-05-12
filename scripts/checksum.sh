#!/bin/bash
#
# Checksum verification helper for Clarity Code releases
# Used by install.sh and for verifying release integrity
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Display usage
usage() {
    cat << EOF
Usage: $(basename "$0") <command> [options]

Commands:
  verify <file> <checksum> [algorithm]
    Verify a file against its checksum
    - file:      Path to the file to verify
    - checksum:  Expected checksum value
    - algorithm: sha256 (default), sha512, or md5

  generate <file> [algorithm]
    Generate checksum for a file
    - file:      Path to the file
    - algorithm: sha256 (default), sha512, or md5

  verify-release <version> <platform> <arch>
    Verify a release tarball from GitHub Releases
    - version:  Release version (e.g., 0.1.0)
    - platform: linux, darwin, or win32
    - arch:     x64 or arm64

  help
    Show this help message

Examples:
  $(basename "$0") verify /path/to/file.tar.gz abc123... sha256
  $(basename "$0") generate /path/to/file.tar.gz sha256
  $(basename "$0") verify-release 0.1.0 linux x64

EOF
}

# Verify a file against a checksum
cmd_verify() {
    local file="$1"
    local expected_checksum="$2"
    local algorithm="${3:-sha256}"
    
    if [ -z "$file" ] || [ -z "$expected_checksum" ]; then
        log_error "Missing required arguments"
        echo "Usage: verify <file> <checksum> [algorithm]"
        exit 1
    fi
    
    if [ ! -f "$file" ]; then
        log_error "File not found: $file"
        exit 1
    fi
    
    local actual_checksum
    case "$algorithm" in
        sha256|sha256sum)
            actual_checksum=$(sha256sum "$file" | cut -d' ' -f1)
            ;;
        sha512)
            actual_checksum=$(sha512sum "$file" | cut -d' ' -f1)
            ;;
        md5)
            actual_checksum=$(md5sum "$file" | cut -d' ' -f1)
            ;;
        shasum)
            actual_checksum=$(shasum -a 256 "$file" | cut -d' ' -f1)
            ;;
        *)
            log_error "Unknown algorithm: $algorithm"
            log_error "Supported: sha256, sha512, md5"
            exit 1
            ;;
    esac
    
    log_info "Expected: $expected_checksum"
    log_info "Actual:   $actual_checksum"
    
    if [ "$actual_checksum" = "$expected_checksum" ]; then
        log_info "✓ Checksum verification PASSED"
        return 0
    else
        log_error "✗ Checksum verification FAILED"
        return 1
    fi
}

# Generate checksum for a file
cmd_generate() {
    local file="$1"
    local algorithm="${2:-sha256}"
    
    if [ -z "$file" ]; then
        log_error "Missing required argument: file"
        echo "Usage: generate <file> [algorithm]"
        exit 1
    fi
    
    if [ ! -f "$file" ]; then
        log_error "File not found: $file"
        exit 1
    fi
    
    case "$algorithm" in
        sha256)
            sha256sum "$file" | cut -d' ' -f1
            ;;
        sha512)
            sha512sum "$file" | cut -d' ' -f1
            ;;
        md5)
            md5sum "$file" | cut -d' ' -f1
            ;;
        shasum)
            shasum -a 256 "$file" | cut -d' ' -f1
            ;;
        *)
            log_error "Unknown algorithm: $algorithm"
            exit 1
            ;;
    esac
}

# Verify a release from GitHub
cmd_verify_release() {
    local version="$1"
    local platform="$2"
    local arch="$3"
    
    if [ -z "$version" ] || [ -z "$platform" ] || [ -z "$arch" ]; then
        log_error "Missing required arguments"
        echo "Usage: verify-release <version> <platform> <arch>"
        exit 1
    fi
    
    local repo_owner="${REPO_OWNER:-apohara}"
    local repo_name="${REPO_NAME:-apohara}"
    
    # Get checksums from GitHub release
    local api_url="https://api.github.com/repos/${repo_owner}/${repo_name}/releases/tags/v${version}"
    
    log_info "Fetching release info for v${version}..."
    
    # Get the checksum file from releases
    local checksum_url="https://github.com/${repo_owner}/${repo_name}/releases/download/v${version}/checksums.txt"
    
    if ! command -v curl &> /dev/null; then
        log_error "curl is required for this operation"
        exit 1
    fi
    
    local temp_dir
    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" RETURN
    
    local checksum_file="${temp_dir}/checksums.txt"
    
    if curl -fsSL "$checksum_url" -o "$checksum_file" 2>/dev/null; then
        log_info "Downloaded checksums from: $checksum_url"
        cat "$checksum_file"
    else
        log_warn "No checksums.txt found in release"
        log_info "Attempting to verify tarball directly..."
        
        local tarball="apohara-${version}-${platform}-${arch}.tar.gz"
        local tarball_url="https://github.com/${repo_owner}/${repo_name}/releases/download/v${version}/${tarball}"
        
        log_info "Downloading: $tarball_url"
        curl -fsSL "$tarball_url" -o "${temp_dir}/${tarball}"
        
        log_info "Generating checksum..."
        cmd_generate "${temp_dir}/${tarball}" sha256
    fi
}

# Main
case "${1:-help}" in
    verify)
        shift
        cmd_verify "$@"
        ;;
    generate)
        shift
        cmd_generate "$@"
        ;;
    verify-release)
        shift
        cmd_verify_release "$@"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        log_error "Unknown command: $1"
        usage
        exit 1
        ;;
esac