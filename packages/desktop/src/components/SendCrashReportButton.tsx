/**
 * SendCrashReportButton — opt-in, local-first UI for spec §0.33.
 *
 * Renders a button that opens a dialog with the redacted JSON payload
 * for human review. The user is the one who decides whether to file
 * the report: we either open a prefilled GitHub issue in their browser
 * OR drop them into their default mail client. Apohara itself NEVER
 * POSTs the report to a server in v1.0 (Pablo's hard rule: local-first,
 * no telemetry-by-default).
 */
import { useState } from "react";
import { redactCrashReport } from "../../../../src/core/crash-reports/redactor";
import type { CrashReport } from "../../../../src/core/crash-reports/jsonl";

interface Props {
  report: CrashReport;
  /** GitHub `org/repo` slug; defaults to the canonical Apohara repo. */
  repoSlug?: string;
  /** Fallback contact address for users who prefer email over a GH issue. */
  contactEmail?: string;
}

export function SendCrashReportButton({
  report,
  repoSlug = "SuarezPM/apohara",
  contactEmail = "crash-reports@apohara.dev",
}: Props) {
  const [open, setOpen] = useState(false);
  const redacted = redactCrashReport(report);
  const payload = JSON.stringify(redacted, null, 2);

  // Both URLs share the same redacted body; the user picks the surface.
  const body = `Apohara crash report (auto-redacted before leaving your machine).\n\n\`\`\`json\n${payload}\n\`\`\``;
  const issueUrl =
    `https://github.com/${repoSlug}/issues/new` +
    `?title=${encodeURIComponent("Crash report")}` +
    `&body=${encodeURIComponent(body)}`;
  const mailtoUrl =
    `mailto:${contactEmail}` +
    `?subject=${encodeURIComponent("Apohara crash report")}` +
    `&body=${encodeURIComponent(body)}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Send to Apohara
      </button>
      {open && (
        <div
          data-testid="send-crash-report-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Send crash report"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 2000,
          }}
        >
          <div style={{ background: "#161b22", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 6, padding: "1.5rem", width: 560, maxWidth: "90vw" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", color: "#d29922" }}>Send crash report</h2>
            <p style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#8b949e" }}>
              Review the redacted payload before sending:
            </p>
            <pre style={{ marginTop: "0.4rem", padding: "0.5rem", background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, fontFamily: "monospace", fontSize: "0.75rem", maxHeight: 240, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {payload}
            </pre>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <a
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: "0.4rem 0.8rem", background: "#1f6feb", color: "white", borderRadius: 4, fontSize: "0.8rem", textDecoration: "none" }}
              >
                Open prefilled GitHub issue
              </a>
              <a
                href={mailtoUrl}
                style={{ padding: "0.4rem 0.8rem", background: "transparent", color: "#58a6ff", border: "1px solid #30363d", borderRadius: 4, fontSize: "0.8rem", textDecoration: "none" }}
              >
                Send via email
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ padding: "0.4rem 0.8rem", background: "transparent", color: "#f85149", border: "1px solid #f85149", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem", marginLeft: "auto" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
