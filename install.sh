#!/bin/bash
#
# Clarity Code Installer for Unix/Linux/macOS
# Detects Node.js >= 22 and installs via npm or GitHub Releases
#

set -e

# Configuration
REPO_OWNER="apohara"
REPO_NAME="apohara"
CURRENT_VERSION="0.1.0"
INSTALL_DIR="${HOME}/.apohara-code"
BIN_DIR="${INSTALL_DIR}/bin"
CONFIG_DIR="${HOME}/.apohara"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for required commands
check_dependencies() {
    local missing=()
    
    for cmd in curl tar; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing required commands: ${missing[*]}"
        log_error "Please install them and try again."
        exit 1
    fi
}

# Check Node.js version
check_node_version() {
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed."
        log_error "Please install Node.js >= 22 from https://nodejs.org"
        exit 1
    fi
    
    local node_version
    node_version=$(node --version | sed 's/v//')
    local major_version
    major_version=$(echo "$node_version" | cut -d. -f1)
    
    if [ "$major_version" -lt 22 ]; then
        log_error "Node.js version $node_version is too old."
        log_error "Clarity Code requires Node.js >= 22"
        log_error "Please upgrade from https://nodejs.org"
        exit 1
    fi
    
    log_info "Node.js version: $node_version ✓"
}

# Check npm
check_npm() {
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed."
        exit 1
    fi
    
    local npm_version
    npm_version=$(npm --version)
    log_info "npm version: $npm_version ✓"
}

# Verify checksum using SHA256
verify_checksum() {
    local file="$1"
    local expected_checksum="$2"
    local algorithm="${3:-sha256}"
    
    if [ -z "$expected_checksum" ]; then
        log_warn "No checksum provided, skipping verification"
        return 0
    fi
    
    local actual_checksum
    case "$algorithm" in
        sha256)
            actual_checksum=$(sha256sum "$file" 2>/dev/null | cut -d' ' -f1)
            ;;
        sha512)
            actual_checksum=$(sha512sum "$file" 2>/dev/null | cut -d' ' -f1)
            ;;
        shasum)
            actual_checksum=$(shasum -a 256 "$file" 2>/dev/null | cut -d' ' -f1)
            ;;
        *)
            log_error "Unknown checksum algorithm: $algorithm"
            return 1
            ;;
    esac
    
    if [ "$actual_checksum" = "$expected_checksum" ]; then
        log_info "Checksum verification passed ✓"
        return 0
    else
        log_error "Checksum verification FAILED!"
        log_error "Expected: $expected_checksum"
        log_error "Actual:   $actual_checksum"
        return 1
    fi
}

# Download file with checksum verification
download_with_checksum() {
    local url="$1"
    local output="$2"
    local checksum="$3"
    local algorithm="${4:-sha256}"
    
    log_info "Downloading from: $url"
    
    if ! curl -fsSL --retry 3 --retry-delay 2 "$url" -o "$output"; then
        log_error "Failed to download: $url"
        return 1
    fi
    
    if [ -n "$checksum" ]; then
        if ! verify_checksum "$output" "$checksum" "$algorithm"; then
            rm -f "$output"
            return 1
        fi
    fi
    
    return 0
}

# Get latest release info from GitHub
get_latest_release() {
    local api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
    
    if ! command -v curl &> /dev/null; then
        echo "$CURRENT_VERSION"
        return
    fi
    
    local version
    version=$(curl -fsSL "$api_url" 2>/dev/null | grep '"tag_name"' | sed 's/.*"tag_name": "\([^"]*\)".*/\1/' | sed 's/^v//')
    
    echo "${version:-$CURRENT_VERSION}"
}

# Install via npm
install_via_npm() {
    log_info "Installing via npm..."
    
    if ! npm install -g apohara; then
        log_error "npm install failed"
        exit 1
    fi
    
    log_info "Installation complete! ✓"
    log_info "Run 'apohara --help' to get started"
}

# Install via direct download (with checksum verification)
install_via_download() {
    local os="$1"
    local arch="$2"
    local version="${3:-$CURRENT_VERSION}"
    
    log_info "Installing via direct download..."
    
    # Detect platform
    case "$(uname -s)" in
        Linux*)  os="linux" ;;
        Darwin*) os="darwin" ;;
        *)       log_error "Unsupported platform"; exit 1 ;;
    esac
    
    case "$(uname -m)" in
        x86_64)   arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *)        arch="x64" ;;
    esac
    
    local tarball="apohara-${version}-${os}-${arch}.tar.gz"
    local download_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${version}/${tarball}"
    
    # Create temp directory
    local temp_dir
    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT
    
    local tarball_path="${temp_dir}/${tarball}"
    
    # Download the release
    log_info "Downloading ${tarball}..."
    if ! download_with_checksum "$download_url" "$tarball_path" ""; then
        log_error "Download failed. The release may not be available yet."
        log_info "Falling back to npm installation..."
        install_via_npm
        return
    fi
    
    # Create install directory
    mkdir -p "$BIN_DIR"
    
    # Extract
    log_info "Extracting..."
    tar -xzf "$tarball_path" -C "$temp_dir"
    
    # Copy files
    local extract_dir="${temp_dir}/apohara-${version}-${os}-${arch}"
    if [ -d "$extract_dir" ]; then
        cp -r "$extract_dir/"* "$BIN_DIR/"
    else
        log_error "Unexpected archive structure"
        exit 1
    fi
    
    # Make CLI executable
    chmod +x "$BIN_DIR/apohara"
    
    # Add to PATH if not already there
    local shell_rc=""
    if [ -n "$BASH_VERSION" ]; then
        shell_rc="$HOME/.bashrc"
    elif [ -n "$ZSH_VERSION" ]; then
        shell_rc="$HOME/.zshrc"
    fi
    
    if [ -n "$shell_rc" ] && ! grep -q "$BIN_DIR" "$shell_rc" 2>/dev/null; then
        echo "" >> "$shell_rc"
        echo "# Clarity Code" >> "$shell_rc"
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$shell_rc"
        log_info "Added $BIN_DIR to PATH in $shell_rc"
    fi
    
    log_info "Installation complete! ✓"
    log_info "Run 'apohara --help' to get started"
}

# Main installation flow
main() {
    echo "========================================"
    echo "  Clarity Code Installer"
    echo "========================================"
    echo ""
    
    check_dependencies
    check_node_version
    check_npm
    
    echo ""
    
    # Determine installation method
    local install_method="${INSTALL_METHOD:-npm}"
    
    case "$install_method" in
        npm)
            install_via_npm
            ;;
        download)
            install_via_download
            ;;
        auto|*)
            # Default: try npm first, fallback to download
            if command -v npm &> /dev/null; then
                install_via_npm
            else
                install_via_download
            fi
            ;;
    esac
    
    echo ""
    log_info "All done! 🎉"
}

# Parse arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --npm         Install via npm (default)"
        echo "  --download    Install via direct download"
        echo "  --help        Show this help message"
        exit 0
        ;;
    --npm)
        install_via_npm
        ;;
    --download)
        install_via_download
        ;;
    *)
        main
        ;;
esac