import { ButtonHTMLAttributes, CSSProperties, forwardRef } from "react";

type Variant = "primary" | "secondary" | "destructive" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const BASE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "8px 12px",
  borderRadius: 0,
  cursor: "pointer",
  border: "1px solid transparent",
  transition: "background 120ms ease, border-color 120ms ease",
};

const VARIANT_STYLE: Record<Variant, CSSProperties> = {
  primary: {
    background: "var(--apohara-lime)",
    color: "var(--apohara-ink)",
    borderColor: "var(--apohara-lime)",
  },
  secondary: {
    background: "transparent",
    color: "var(--apohara-lime)",
    borderColor: "var(--apohara-lime)",
  },
  destructive: {
    background: "var(--apohara-red)",
    color: "var(--apohara-bone)",
    borderColor: "var(--apohara-red)",
  },
  ghost: {
    background: "transparent",
    color: "var(--apohara-bone)",
    borderColor: "transparent",
  },
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", style, ...rest }, ref) => (
    <button
      ref={ref}
      style={{ ...BASE_STYLE, ...VARIANT_STYLE[variant], ...style }}
      {...rest}
    />
  )
);
Button.displayName = "Button";
