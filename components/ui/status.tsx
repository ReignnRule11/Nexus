import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function Skeleton({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton-block" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="skeleton-line" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-panel" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <p className="muted" role="status" aria-live="polite">
      {label}...
    </p>
  );
}

export function StatusMessage({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error" | "success";
}) {
  return (
    <p className={`status-message status-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}
