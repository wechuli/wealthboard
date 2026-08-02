import Link from "next/link";
import { CircleDollarSign, RefreshCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Offline · Worthboard" };

export default function OfflinePage() {
  return (
    <main className="financial-grid flex min-h-screen items-center justify-center p-5">
      <section className="max-w-md rounded-3xl border border-white/10 bg-[#101615] p-8 text-center shadow-2xl">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-slate-300">
          <WifiOff size={23} />
        </span>
        <div className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-300">
          <CircleDollarSign size={15} />Worthboard
        </div>
        <h1 className="mt-3 text-2xl font-semibold">You’re offline</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          The app shell is available, but fresh financial data and all changes require a secure connection to your server. Nothing will be queued.
        </p>
        <Button asChild className="mt-6"><Link href="/"><RefreshCw size={16} />Try again</Link></Button>
      </section>
    </main>
  );
}
