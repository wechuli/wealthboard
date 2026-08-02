import { BarChart3, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { SignupForm } from "@/components/signup-form";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="financial-grid flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101615]/95 p-7 shadow-2xl sm:p-9">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-950/40">
          <BarChart3 size={24} strokeWidth={2.4} />
        </div>
        <p className="mt-7 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
          Wealthboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Create your private portfolio.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Your accounts, categories, and reports stay independent from every other user.
        </p>
        <SignupForm />
        <div className="mt-7 flex items-center gap-2 border-t border-white/[0.07] pt-5 text-xs text-slate-500">
          <ShieldCheck size={15} />
          Local authentication with isolated financial data
        </div>
      </section>
    </main>
  );
}
