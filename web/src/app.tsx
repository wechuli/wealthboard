import { zodResolver } from "@hookform/resolvers/zod";
import {
  BarChart3,
  CircleDollarSign,
  Eye,
  EyeOff,
  Landmark,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Target,
  WalletCards,
  X,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { z } from "zod";

import { ApiError, getAuthConfig, getOverview, getSession, login, logout, signup } from "./api";
import { formatMinorUnits } from "./format";
import type { AuthConfig, Overview, Session } from "./types";

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  password: z.string().min(1).max(256),
});

const signupSchema = z
  .object({
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
    displayName: z.string().trim().min(1).max(80),
    baseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    password: z.string().min(12).max(256),
    confirmPassword: z.string().max(256),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

type LoginInput = z.infer<typeof loginSchema>;
type SignupInput = z.infer<typeof signupSchema>;

export function App() {
  const [session, setSession] = useState<Session | null | undefined>();
  const [authConfig, setAuthConfig] = useState<AuthConfig>();

  useEffect(() => {
    void getAuthConfig().then(setAuthConfig);
    void getSession()
      .then((value) => setSession(value))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) setSession(null);
        else setSession(undefined);
      });
  }, []);

  if (session === undefined || !authConfig) return <LoadingScreen />;
  if (session === null) return <AuthScreen config={authConfig} onAuthenticated={setSession} />;
  return <AuthenticatedApp session={session} onSignedOut={() => setSession(null)} />;
}

function AuthScreen({ config, onAuthenticated }: { config: AuthConfig; onAuthenticated: (session: Session) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  return (
    <main className="auth-layout">
      <section className="auth-brand" aria-label="Wealthboard">
        <div className="brand-mark"><CircleDollarSign aria-hidden /></div>
        <p className="eyebrow">Private wealth</p>
        <h1>Wealthboard</h1>
        <p className="auth-copy">Your accounts, goals, and financial position in one focused workspace.</p>
      </section>
      <section className="auth-panel">
        {config.localEnabled ? <><div className="segmented" aria-label="Authentication mode">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button>
        </div>
        {mode === "login" ? <LoginForm onAuthenticated={onAuthenticated} /> : <SignupForm onAuthenticated={onAuthenticated} />}</> : null}
        {config.oidcEnabled ? <a className="oidc-button" href="/api/v1/auth/oidc/start">
          <ShieldCheck size={18} /> Continue with {config.providerName || "SSO"}
        </a> : null}
      </section>
    </main>
  );
}

function LoginForm({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [error, setError] = useState("");
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const submit = handleSubmit(async (values) => {
    setError("");
    try {
      onAuthenticated(await login(values));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
    }
  });
  return (
    <form onSubmit={submit} className="auth-form">
      <div><label htmlFor="username">Username</label><input id="username" autoComplete="username" {...register("username")} /></div>
      <div><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" {...register("password")} /></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={formState.isSubmitting} type="submit">{formState.isSubmitting ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}

function SignupForm({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [error, setError] = useState("");
  const { register, handleSubmit, formState } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { baseCurrency: "KES" },
  });
  const submit = handleSubmit(async (values) => {
    setError("");
    try {
      onAuthenticated(await signup(values));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Account creation failed.");
    }
  });
  return (
    <form onSubmit={submit} className="auth-form">
      <div className="form-grid"><div><label htmlFor="signup-username">Username</label><input id="signup-username" autoComplete="username" {...register("username")} /></div><div><label htmlFor="display-name">Display name</label><input id="display-name" autoComplete="name" {...register("displayName")} /></div></div>
      <div><label htmlFor="base-currency">Base currency</label><input id="base-currency" maxLength={3} {...register("baseCurrency")} /></div>
      <div className="form-grid"><div><label htmlFor="new-password">Password</label><input id="new-password" type="password" autoComplete="new-password" {...register("password")} /></div><div><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" {...register("confirmPassword")} /></div></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={formState.isSubmitting} type="submit">{formState.isSubmitting ? "Creating..." : "Create account"}</button>
    </form>
  );
}

function AuthenticatedApp({ session, onSignedOut }: { session: Session; onSignedOut: () => void }) {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, setHidden] = useState(() => localStorage.getItem("wealthboard-values-hidden") === "true");
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("theme-preference") === "light" ? "light" : "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme-preference", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("wealthboard-values-hidden", String(hidden));
  }, [hidden]);
  useEffect(() => {
    void getOverview().then((value) => startTransition(() => setOverview(value))).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Overview unavailable."));
  }, []);

  const signOut = async () => {
    await logout(session.csrfToken);
    sessionStorage.clear();
    localStorage.removeItem("wealthboard-values-hidden");
    onSignedOut();
  };
  const appName = overview?.settings.appName ?? "Wealthboard";
  const displayName = overview?.settings.displayName ?? session.user.username;
  return (
    <div className="app-layout">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-brand"><span className="brand-mark small"><CircleDollarSign /></span><div><strong>{appName}</strong><span>Private wealth</span></div><button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X /></button></div>
        <nav aria-label="Primary navigation">
          <NavLink to="/" end><BarChart3 /> Overview</NavLink>
          <NavLink to="/accounts"><Landmark /> Accounts</NavLink>
        </nav>
      </aside>
      {menuOpen ? <button className="nav-overlay" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu /></button>
          <div className="welcome"><strong>Welcome back, {displayName}</strong><span>{session.user.username}</span></div>
          <div className="toolbar">
            <button className="icon-button" aria-label={hidden ? "Show values" : "Hide values"} title={hidden ? "Show values" : "Hide values"} onClick={() => setHidden((value) => !value)}>{hidden ? <Eye /> : <EyeOff />}</button>
            <button className="icon-button" aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun /> : <Moon />}</button>
            <button className="icon-button" aria-label="Log out" onClick={() => void signOut()}><LogOut /></button>
          </div>
        </header>
        <main className="content">
          {error ? <div className="notice error" role="alert">{error}</div> : null}
          {!overview && !error ? <LoadingPanel /> : null}
          {overview ? <Routes><Route path="/" element={<OverviewPage overview={overview} hidden={hidden} />} /><Route path="/accounts" element={<AccountsPage overview={overview} hidden={hidden} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes> : null}
        </main>
      </div>
    </div>
  );
}

function OverviewPage({ overview, hidden }: { overview: Overview; hidden: boolean }) {
  const money = (value: string) => hidden ? "••••••" : formatMinorUnits(value, overview.settings.baseCurrency);
  return <>
    <div className="page-heading"><div><p className="eyebrow">Portfolio</p><h1>Overview</h1><p>What you own, owe, and are building toward.</p></div></div>
    {!overview.currentComplete ? <div className="notice warning">Some values need exchange rates: {overview.missingCurrencies.join(", ")}.</div> : null}
    <section className="net-worth-band"><div><span>Total net worth</span><strong className={hidden ? "masked" : ""}>{money(overview.totals.netWorth)}</strong><small>{overview.accountCount} active accounts · {overview.goalCount} active goals</small></div><CircleDollarSign aria-hidden /></section>
    <section className="metric-grid" aria-label="Portfolio totals">
      <Metric label="Assets" value={money(overview.totals.assets)} icon={<Landmark />} />
      <Metric label="Liabilities" value={money(overview.totals.liabilities)} icon={<WalletCards />} />
      <Metric label="Liquid" value={money(overview.totals.liquid)} icon={<CircleDollarSign />} />
      <Metric label="Investible" value={money(overview.totals.investible)} icon={<Target />} />
    </section>
    <section className="section-block"><div className="section-heading"><h2>Accounts</h2><NavLink to="/accounts">View all</NavLink></div><AccountTable accounts={overview.accounts.slice(0, 5)} hidden={hidden} /></section>
  </>;
}

function AccountsPage({ overview, hidden }: { overview: Overview; hidden: boolean }) {
  return <><div className="page-heading"><div><p className="eyebrow">Portfolio</p><h1>Accounts</h1><p>{overview.accountCount} active financial accounts.</p></div></div><section className="section-block"><AccountTable accounts={overview.accounts} hidden={hidden} /></section></>;
}

function AccountTable({ accounts, hidden }: { accounts: Overview["accounts"]; hidden: boolean }) {
  if (accounts.length === 0) return <div className="empty-state"><Landmark /><h2>No accounts yet</h2><p>Your account list will appear here.</p></div>;
  return <div className="account-list">{accounts.map((account) => <article className="account-row" key={account.id}><div className="account-icon"><Landmark /></div><div className="account-main"><strong>{account.name}</strong><span>{account.institutionName || account.categoryName}</span></div><div className="account-value"><strong className={hidden ? "masked" : ""}>{hidden ? "••••••" : formatMinorUnits(account.currentValueMinor, account.currency)}</strong><span>{account.isLiability ? "Liability" : account.categoryName}</span></div></article>)}</div>;
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <article className="metric"><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}

function LoadingScreen() { return <main className="loading-screen"><CircleDollarSign /><span>Loading Wealthboard</span></main>; }
function LoadingPanel() { return <div className="loading-panel" role="status">Loading overview...</div>; }