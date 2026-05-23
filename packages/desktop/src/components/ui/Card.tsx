import { FC, HTMLAttributes, CSSProperties } from "react";

const STYLE: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  padding: 12,
  borderRadius: 0,
};

export const Card: FC<HTMLAttributes<HTMLDivElement>> = ({ style, ...rest }) => (
  <div style={{ ...STYLE, ...style }} {...rest} />
);
