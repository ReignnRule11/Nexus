import type { ReactNode } from "react";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <article className={["card", className].filter(Boolean).join(" ")}>{children}</article>;
}
