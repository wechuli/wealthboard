import { redirect } from "next/navigation";
import { BarChart3, LogIn, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/components/login-form";
import { Button } from "@/components/ui/button";
import { getAuthConfig } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const oidcErrors: Record<string, string> = {
  unavailable: "Provider sign-in is temporarily unavailable. Try again later.",
  provider: "Provider sign-in was cancelled or rejected.",
  invalid_callback: "The provider response could not be verified. Try again.",
  access_denied: "Sign in is not available for this account.",
  rate_limited: "Too many sign-in requests. Try again later.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ oidc_error?: string; next?: string }>;
}) {
  if (await getSession()) redirect("/");
  const authConfig = getAuthConfig();
  const query = await searchParams;
  const oidcError = query.oidc_error
    ? (oidcErrors[query.oidc_error] ?? oidcErrors.invalid_callback)
    : null;
  const oidcHref = new URLSearchParams();
  if (query.next) oidcHref.set("next", query.next);
  return (
    <main className="financial-grid flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[var(--panel)] p-7 shadow-2xl sm:p-9">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-950/40">
          <BarChart3 size={24} strokeWidth={2.4} />
        </div>
        <p className="mt-7 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
          Wealthboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Your wealth, in focus.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Sign in to your private financial dashboard. Your data stays on this
          server.
        </p>
        {authConfig.localEnabled ? <LoginForm /> : null}
        {authConfig.localEnabled && authConfig.oidcEnabled ? (
          <div className="my-6 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-xs uppercase text-slate-500">or</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
        ) : null}
        {authConfig.oidcEnabled && authConfig.oidc ? (
          <div className={authConfig.localEnabled ? "" : "mt-8"}>
            {oidcError ? (
              <p
                role="alert"
                className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"
              >
                {oidcError.replace("Provider", authConfig.oidc.providerName)}
              </p>
            ) : null}
            <Button
              asChild
              className="w-full"
              variant={authConfig.localEnabled ? "secondary" : "default"}
            >
              <a
                href={`/api/auth/oidc/start${oidcHref.size ? `?${oidcHref}` : ""}`}
              >
                <LogIn size={17} />
                Continue with {authConfig.oidc.providerName}
              </a>
            </Button>
          </div>
        ) : null}
        <div className="mt-7 flex items-center gap-2 border-t border-white/[0.07] pt-5 text-xs text-slate-500">
          <ShieldCheck size={15} />
          Private, independent portfolios
        </div>
      </section>
    </main>
  );
}
