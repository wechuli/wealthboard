import type { ReactNode } from "react";

export function PageHeader({ title, description, eyebrow, actions }: { title: string; description: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`read-card ${className}`.trim()}>{children}</section>;
}

export function CardHeader({ title, description, aside }: { title: string; description?: string; aside?: ReactNode }) {
  return (
    <header className="read-card-header">
      <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
      {aside}
    </header>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "positive" | "warning" }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><h2>{title}</h2><p>{description}</p></div>;
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <div className="loading-panel" role="status">{label}</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="notice error" role="alert">{message}</div>;
}

export function ResourceView<T>({ state, children, loadingLabel }: { state: import("./use-resource").ResourceState<T>; children: (data: T) => ReactNode; loadingLabel?: string }) {
  if (state.status === "loading") return <LoadingState label={loadingLabel} />;
  if (state.status === "error") return <ErrorState message={state.message} />;
  return children(state.data);
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return <div className="key-value"><span>{label}</span><strong>{children}</strong></div>;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
