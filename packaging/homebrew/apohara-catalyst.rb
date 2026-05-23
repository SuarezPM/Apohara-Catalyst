# Phase 4 G4.B — Homebrew formula draft.
# Publish to Pablo's tap (e.g. SuarezPM/homebrew-apohara) only after Pablo
# signs off the launch (sign-off.md gate). sha256 placeholders below
# replaced from release.yml .sha256 sidecars at sign-off time.

class ApoharaCatalyst < Formula
  desc "Local-first multi-AI orchestrator (Rust-native, parallel CLI dispatch)"
  homepage "https://github.com/SuarezPM/Apohara"
  license "MIT"
  version "1.0.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/SuarezPM/Apohara/releases/download/v#{version}/apohara-aarch64-apple-darwin.tar.gz"
      sha256 "REPLACE_AARCH64_DARWIN_SHA256"
    else
      url "https://github.com/SuarezPM/Apohara/releases/download/v#{version}/apohara-x86_64-apple-darwin.tar.gz"
      sha256 "REPLACE_X86_64_DARWIN_SHA256"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/SuarezPM/Apohara/releases/download/v#{version}/apohara-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "REPLACE_AARCH64_LINUX_SHA256"
    else
      url "https://github.com/SuarezPM/Apohara/releases/download/v#{version}/apohara-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "REPLACE_X86_64_LINUX_SHA256"
    end
  end

  depends_on "git"

  def install
    bin.install "apohara"
    bin.install "apohara-tui"
    doc.install "README.md", "RELEASE_NOTES.md"
  end

  test do
    assert_match "apohara #{version}", shell_output("#{bin}/apohara --version")
  end
end
