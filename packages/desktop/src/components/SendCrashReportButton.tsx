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
        <div role="dialog" aria-label="Send crash report">
          <p>Review the redacted payload before sending:</p>
          <pre>{payload}</pre>
          <a href={issueUrl} target="_blank" rel="noopener noreferrer">
            Open prefilled GitHub issue
          </a>
          <a href={mailtoUrl}>Send via email</a>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
