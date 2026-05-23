# macOS Notarization Smoke — Apohara Catalyst v1.0.0-rc.1

The npm package distribution does NOT require Apple notarization — `apohara`
installed via `npm install -g` runs as a Node script, not as a signed app
bundle. macOS Gatekeeper does not gate Node scripts.

## If we ever ship a Tauri `.app` / `.dmg`

(Out of scope for v1.0.0 — npm is the only release channel for Sprint 11.)

Notarization requires:
- Apple Developer ID certificate ($99/yr).
- `codesign --sign "Developer ID Application: ..." --options runtime --deep`.
- `xcrun notarytool submit ... --wait`.
- `xcrun stapler staple ...`.

Track as a follow-up when Tauri distribution lands (v1.1+).

## Verification (manual, macOS-14)

1. Install via npm: `npm install -g @apohara/catalyst@1.0.0-rc.1`
2. Run `apohara doctor` — verify NO Gatekeeper prompt appears.
3. Run `apohara --version` — exits 0.

## Resultados

| Date (UTC) | macOS version | Tester | Result | Notes |
|---|---|---|---|---|
| _PENDING_ | macos-14 | Pablo | _TBD_ | First smoke before launch |
