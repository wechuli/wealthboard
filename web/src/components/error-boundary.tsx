import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/primitives";

type ErrorBoundaryProps = {
  children: ReactNode;
  // Clears a caught error when it changes, such as on navigation.
  resetKey?: unknown;
  fullScreen?: boolean;
};

type ErrorBoundaryState = {
  failed: boolean;
  resetKey?: unknown;
};

// Replaces a crashed view with a recoverable message instead of a blank page.
// React reports the caught error to the browser console; the message itself is
// not shown because it can contain financial data.
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    failed: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const fallback = (
      <div
        role="alert"
        className="mx-auto max-w-lg space-y-4 rounded-xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-100"
      >
        <div className="flex items-center gap-2 font-semibold text-red-200">
          <AlertTriangle size={17} className="shrink-0" />
          Something went wrong
        </div>
        <p>
          This view stopped because of an unexpected error. If you were saving a
          change, check whether it was applied before trying again. Technical
          details are in the browser console.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => this.setState({ failed: false })}
          >
            <RotateCcw size={16} /> Try again
          </Button>
          <Button type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Reload page
          </Button>
        </div>
      </div>
    );
    return this.props.fullScreen ? (
      <main className="financial-grid flex min-h-screen items-center justify-center px-5">
        {fallback}
      </main>
    ) : (
      <div className="py-10">{fallback}</div>
    );
  }
}
