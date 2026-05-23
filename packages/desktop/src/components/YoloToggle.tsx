import { useState } from "react";

interface Props {
  workspacePath: string;
  envEnabled: boolean;
  allowlistPresent: boolean;
}

/**
 * Triple-gate yolo toggle UI. The toggle reflects ALL three gates:
 * env, this UI state, and the per-workspace allowlist file.
 *
 * IMPORTANT: this component DOES NOT write the allowlist file —
 * that's a deliberate manual step by the user (mkdir .apohara &&
 * echo "approved" > .apohara/yolo-allowed). UI only shows status.
 */
export function YoloToggle({ workspacePath, envEnabled, allowlistPresent }: Props) {
  const [uiToggle, setUiToggle] = useState(false);
  const allEnabled = envEnabled && uiToggle && allowlistPresent;

  return (
    <div className="yolo-toggle" data-testid="yolo-toggle">
      <h3>YOLO Mode (DANGEROUS — full auto)</h3>
      <ul>
        <li>Env (APOHARA_YOLO=1): {envEnabled ? "OK" : "MISSING"}</li>
        <li>UI toggle: {uiToggle ? "ON" : "OFF"}</li>
        <li>
          Workspace allowlist ({workspacePath}/.apohara/yolo-allowed):{" "}
          {allowlistPresent ? "OK" : "MISSING"}
        </li>
        <li>
          Effective state: <strong>{allEnabled ? "ENABLED" : "DISABLED"}</strong>
        </li>
      </ul>
      <button onClick={() => setUiToggle(!uiToggle)} data-testid="yolo-toggle-button">
        {uiToggle ? "Disable UI toggle" : "Enable UI toggle (session-scoped)"}
      </button>
      {!allowlistPresent && <p>To enable, manually create the allowlist file:</p>}
      {!allowlistPresent && (
        <pre>
          mkdir -p {workspacePath}/.apohara && echo "approved" {">"} {workspacePath}
          /.apohara/yolo-allowed
        </pre>
      )}
    </div>
  );
}
