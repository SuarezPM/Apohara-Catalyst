import { createContext, FC, ReactNode, useCallback, useContext, useState, CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmationDialogProvider");
  return ctx;
};

interface QueueEntry extends ConfirmOptions {
  resolve: (result: boolean) => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.6)",
  zIndex: 2000,
};

const contentStyle: CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  background: "var(--apohara-dark-2)",
  border: "2px solid var(--apohara-lime)",
  borderRadius: 0,
  padding: 24,
  maxWidth: 480,
  fontFamily: "var(--font-sans)",
  color: "var(--apohara-bone)",
  zIndex: 2001,
};

const buttonBaseStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "8px 12px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--apohara-bone)",
  cursor: "pointer",
  borderRadius: 0,
};

export const ConfirmationDialogProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const current = queue[0];

  const confirm: ConfirmFn = useCallback(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setQueue((q) => [...q, { ...opts, resolve }]);
      }),
    []
  );

  const respond = (result: boolean) => {
    if (!current) return;
    current.resolve(result);
    setQueue((q) => q.slice(1));
  };

  const confirmButtonStyle: CSSProperties = {
    ...buttonBaseStyle,
    background: current?.variant === "destructive" ? "var(--apohara-red)" : "var(--apohara-lime)",
    color: current?.variant === "destructive" ? "var(--apohara-bone)" : "var(--apohara-ink)",
    border: "none",
    marginLeft: 8,
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog.Root open={!!current} onOpenChange={(o) => !o && respond(false)}>
        <Dialog.Portal>
          <Dialog.Overlay style={overlayStyle} />
          <Dialog.Content style={contentStyle} data-testid="confirmation-dialog">
            <Dialog.Title
              className="font-display"
              style={{ color: "var(--apohara-lime)", fontSize: 14, marginBottom: 12, letterSpacing: 2 }}
            >
              {current?.title}
            </Dialog.Title>
            {current?.description && (
              <Dialog.Description style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(237, 239, 240, 0.85)", marginBottom: 16 }}>
                {current.description}
              </Dialog.Description>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button style={buttonBaseStyle} onClick={() => respond(false)}>
                {current?.cancelLabel ?? "Cancel"}
              </button>
              <button style={confirmButtonStyle} onClick={() => respond(true)}>
                {current?.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
};
