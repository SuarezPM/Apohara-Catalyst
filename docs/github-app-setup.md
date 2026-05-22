# GitHub App Setup for Apohara

Apohara's `github-bridge` (Stage 9) creates orchestration tasks from
GitHub Issues labeled `apohara` and posts PRs back when runs complete.
For TOS-safe authentication (no Personal Access Tokens), Apohara uses
GitHub App auth.

This document walks through one-time setup.

## 1. Create the GitHub App

Navigate to https://github.com/settings/apps/new (for a personal
account) or your organization's app settings.

Use this manifest JSON to pre-fill the form:

```json
{
  "name": "Apohara Orchestrator",
  "url": "https://apohara.dev",
  "hook_attributes": {
    "url": "https://your-host/apohara-webhook"
  },
  "redirect_url": "https://apohara.dev/setup",
  "callback_urls": ["https://apohara.dev/auth/callback"],
  "default_permissions": {
    "issues": "write",
    "pull_requests": "write",
    "contents": "read"
  },
  "default_events": ["issues", "issue_comment"]
}
```

**Note**: v1.0 ships poll-only, so the `hook_attributes.url` is
reserved but not actively delivered to. v1.1+ webhook worker uses it.

## 2. Install on Repositories

After creating the App:

1. Open the App's settings page.
2. Click **Install App** in the left sidebar.
3. Select the repositories Apohara should monitor.
4. Click **Install**.

## 3. Generate Private Key

1. On the App's settings page, scroll to **Private keys**.
2. Click **Generate a private key**.
3. A `.pem` file downloads automatically.
4. Move it to a secure location:

```bash
mkdir -p ~/.apohara
mv ~/Downloads/apohara-orchestrator.YYYY-MM-DD.private-key.pem ~/.apohara/github-app.private-key.pem
chmod 0600 ~/.apohara/github-app.private-key.pem
```

The 0600 permission ensures only your user can read the key.

## 4. Note the App ID

On the App's settings page, the **App ID** is shown near the top
(e.g. `123456`). Copy it.

## 5. Set Environment Variables

Add to your shell config (`~/.zshenv` or `~/.bashrc`):

```bash
export APOHARA_GITHUB_APP_ID="123456"
export APOHARA_GITHUB_APP_PRIVATE_KEY_PATH="$HOME/.apohara/github-app.private-key.pem"
```

Reload: `source ~/.zshenv` (or restart your shell).

## 6. Verify Setup

Run the doctor command (available in Stage 10):

```bash
apohara provider doctor github
```

Expected output:
```
✓ APOHARA_GITHUB_APP_ID set
✓ APOHARA_GITHUB_APP_PRIVATE_KEY_PATH readable + 0600 perms
✓ GitHub App auth roundtrip OK
✓ Installation found: <repo list>
```

If any step fails, the command points to the troubleshooting line below.

## 7. Apply the `apohara` Label

For Apohara to pick up an issue, label it `apohara`. The label triggers
the poller (60s cadence) which parses the issue body + creates an
orchestration task.

After Apohara processes:
- `apohara-in-progress` label added → task dispatched, run started
- `apohara-needs-input` label added → issue body was ambiguous (a clarifying comment is posted; reply + remove this label to retry)
- `apohara-done` label added → PR opened, link in the comment

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `APOHARA_GITHUB_APP_ID not set` | env not exported in current shell | re-run `source ~/.zshenv` or restart shell |
| `cannot read private key file` | wrong path or wrong perms | check `ls -la $APOHARA_GITHUB_APP_PRIVATE_KEY_PATH`; should be `-rw-------` (0600) |
| `installation not found` | App not installed on the repo | redo step 2 |
| `permission denied (issues/write)` | App permissions too narrow | edit App settings → permissions → add issues:write |
| Issue not picked up after 60s | label name typo or polled wrong repo | check label is exactly `apohara` (case-sensitive) and repo is in App's installation list |

## Security Notes

- **NEVER** commit `github-app.private-key.pem` to git. Apohara's
  `.gitignore` excludes the path by default.
- **NEVER** share the private key. If compromised, regenerate it
  immediately in the App's settings.
- The installation token (derived from the App private key) is
  short-lived (TTL ~60min) — Apohara refreshes proactively at 50min.
- Apohara writes the installation token to memory only, never to disk.
- For multi-machine setups, generate a separate private key per
  machine to limit blast radius.

## Next Steps

After setup, see:
- `docs/superpowers/specs/2026-05-21-apohara-v1-design.md` §5 — github-bridge spec
- `docs/superpowers/plans/2026-05-22-apohara-v1.md` Stage 9 — implementation