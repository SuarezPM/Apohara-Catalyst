class Apohara < Formula
  desc "Multi-agent code orchestration with local CLI providers (Claude Code / Codex / OpenCode)"
  homepage "https://github.com/SuarezPM/Apohara"
  url "https://github.com/SuarezPM/Apohara/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "REPLACE_AT_RELEASE_TIME_WITH_TARBALL_SHA256"
  license "MIT"
  version "1.0.0"

  depends_on "bun"
  depends_on "rust" => :build
  depends_on "node" => :build

  def install
    system "bun", "install", "--frozen-lockfile"
    system "bun", "run", "build"
    system "cargo", "build", "--release", "--workspace"

    bin.install "dist/apohara"
    bin.install "target/release/apohara-worktree-cli" => "apohara-worktree"
    libexec.install Dir["packaging/runtime/*"]

    pkgshare.install "PRINCIPLES.md", "CHANGELOG.md"
  end

  service do
    run [opt_bin/"apohara", "daemon", "--foreground"]
    keep_alive false
    log_path var/"log/apohara.log"
    error_log_path var/"log/apohara.error.log"
  end

  def caveats
    <<~EOS
      Apohara needs at least one CLI provider on PATH:
        - claude-code-cli  (https://docs.anthropic.com/claude-code)
        - codex-cli        (https://github.com/openai/codex)
        - opencode-go      (https://github.com/opencode-ai/opencode)

      Run `apohara doctor` to verify your installation.
      Run `apohara verify-setup` to enroll LOCAL-SETUP-001 (end-to-end pipeline check).
    EOS
  end

  test do
    assert_match "apohara", shell_output("#{bin}/apohara --version")
    assert_match "doctor", shell_output("#{bin}/apohara doctor --help")
  end
end