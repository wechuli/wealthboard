"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto text-amber-300" size={40} />
        <h1 className="mt-5 text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-400">
          Worthboard could not load this view. No financial changes were made.
        </p>
        {error.digest ? <p className="mt-2 text-xs text-slate-600">Reference: {error.digest}</p> : null}
        <Button className="mt-6" onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
