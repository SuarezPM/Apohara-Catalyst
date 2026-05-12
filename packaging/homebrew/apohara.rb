# Homebrew formula skeleton for Apohara — Phase 6.6
#
# This file is a *template*: the version pin and SHA256 hashes are
# placeholders. The release pipeline (`.github/workflows/release.yml`)
# is responsible for re-rendering this file with the real values
# alongside each `v*` tag push and committing it to the user's tap
# repo (typically `SuarezPM/homebrew-tap`).
#
# Install path once the tap is published:
#
#     brew tap SuarezPM/tap
#     brew install apohara
#
# Until then `curl … install.sh | sh` from the README is the
# canonical install route.

class Apohara < Formula
  desc "Visual vibecoding orchestrator: multi-agent LLM swarm with verification mesh"
  homepage "https://github.com/SuarezPM/Apohara"
  version "0.0.0"  # populated by release.yml at tag time
  license "MIT"

  # Bottle URLs follow the matrix from .github/workflows/desktop-release.yml:
  #   apohara-desktop-darwin-x64.tar.gz
  #   apohara-desktop-darwin-arm64.tar.gz
  #
  # SHA256s below are 64 hex zeros until the first signed release lands.

  if Hardware::CPU.arm?
    url "https://github.com/SuarezPM/Apohara/releases/download/v#{version}/apohara-desktop-darwin-arm64.tar.gz"
    sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  else
    url "https://github.com/SuarezPM/Apohara/releases/download/v#{version}/apohara-desktop-darwin-x64.tar.gz"
    sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  end

  def install
    bin.install "apohara-desktop" => "apohara"
  end

  test do
    assert_match "apohara", shell_output("#{bin}/apohara --version", 0).downcase
  end
end
