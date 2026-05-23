import { InputHTMLAttributes, CSSProperties, forwardRef } from "react";

const STYLE: CSSProperties = {
  background: "var(--apohara-dark)",
  border: "1px solid var(--border)",
  color: "var(--apohara-bone)",
  padding: "8px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  borderRadius: 0,
  outline: "none",
};

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ style, onFocus, onBlur, ...rest }, ref) => (
    <input
      ref={ref}
      style={{ ...STYLE, ...style }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--apohara-lime)";
        onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        onBlur?.(e);
      }}
      {...rest}
    />
  )
);
Input.displayName = "Input";
