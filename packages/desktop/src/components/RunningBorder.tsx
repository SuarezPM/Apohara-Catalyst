import { FC, ReactNode } from "react";

interface Props {
  active: boolean;
  children: ReactNode;
}

export const RunningBorder: FC<Props> = ({ active, children }) => (
  <div className={active ? "running-border" : ""}>{children}</div>
);

export default RunningBorder;
