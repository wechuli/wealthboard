import { BarChart3, Goal, Landmark, WifiOff } from "lucide-react";

const items = [
  ["Dashboard", BarChart3],
  ["Accounts", Landmark],
  ["Goals", Goal],
] as const;

export const metadata = { title: "Offline · Wealthboard" };

export default function OfflineShellPage() {
  return (
    <main className="min-h-screen bg-[#090d0d] p-4">
      <header className="flex h-14 items-center gap-3 border-b border-white/[0.07]">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 text-emerald-950">
          <BarChart3 size={18} />
        </span>
        <span className="font-semibold">Wealthboard</span>
      </header>
      <section className="mx-auto mt-10 max-w-lg rounded-3xl border border-white/10 bg-[#111716] p-7 text-center">
        <WifiOff className="mx-auto text-amber-300" size={30} />
        <h1 className="mt-4 text-2xl font-semibold">
          Your dashboard is offline
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          This cached shell keeps Wealthboard launchable. Reconnect to load
          current balances, history, and goals. Financial changes are disabled
          and will not be queued.
        </p>
        <div className="mt-6 grid grid-cols-3 gap-2">
          {items.map(([label, Icon]) => (
            <div
              key={label}
              className="rounded-xl bg-white/[0.04] p-3 text-xs text-slate-500"
            >
              <Icon className="mx-auto mb-2" size={17} />
              {label}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
