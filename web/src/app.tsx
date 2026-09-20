import { zodResolver } from "@hookform/resolvers/zod";
import { CircleDollarSign, ShieldCheck } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, Route, Routes } from "react-router-dom";
import { z } from "zod";

import {
  ApiError,
  getAuthConfig,
  getOverview,
  getSession,
  login,
  logout,
  signup,
} from "./api";
import { AppShell, clearUserState } from "./shell";
import { OfflinePage } from "./pwa";
import type { AuthConfig, Overview, Session } from "./types";

const DashboardPage = lazy(() =>
  import("./core-pages").then((module) => ({ default: module.DashboardPage })),
);
const AccountsPage = lazy(() =>
  import("./core-pages").then((module) => ({ default: module.AccountsPage })),
);
const AccountDetailPage = lazy(() =>
  import("./core-pages").then((module) => ({
    default: module.AccountDetailPage,
  })),
);
const TransactionsPage = lazy(() =>
  import("./core-pages").then((module) => ({
    default: module.TransactionsPage,
  })),
);
const GoalsPage = lazy(() =>
  import("./core-pages").then((module) => ({ default: module.GoalsPage })),
);
const GoalDetailPage = lazy(() =>
  import("./core-pages").then((module) => ({
    default: module.GoalDetailPage,
  })),
);
const ReportsPage = lazy(() =>
  import("./core-pages").then((module) => ({ default: module.ReportsPage })),
);
const CategoriesPage = lazy(() =>
  import("./feature-pages").then((module) => ({
    default: module.CategoriesPage,
  })),
);
const InstitutionsPage = lazy(() =>
  import("./feature-pages").then((module) => ({
    default: module.InstitutionsPage,
  })),
);
const InstrumentsPage = lazy(() =>
  import("./feature-pages").then((module) => ({
    default: module.InstrumentsPage,
  })),
);
const InstrumentDetailPage = lazy(() =>
  import("./feature-pages").then((module) => ({
    default: module.InstrumentDetailPage,
  })),
);
const EstatePage = lazy(() =>
  import("./feature-pages").then((module) => ({ default: module.EstatePage })),
);
const EstateSnapshotPage = lazy(() =>
  import("./feature-pages").then((module) => ({
    default: module.EstateSnapshotPage,
  })),
);
const ReviewPage = lazy(() =>
  import("./feature-pages").then((module) => ({ default: module.ReviewPage })),
);
const SettingsPage = lazy(() =>
  import("./settings-page").then((module) => ({
    default: module.SettingsPage,
  })),
);

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/),
  password: z.string().min(1).max(256),
});

const signupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,32}$/),
    displayName: z.string().trim().min(1).max(80),
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
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
  if (session === null)
    return <AuthScreen config={authConfig} onAuthenticated={setSession} />;
  return (
    <AuthenticatedApp session={session} onSignedOut={() => setSession(null)} />
  );
}

function AuthScreen({
  config,
  onAuthenticated,
}: {
  config: AuthConfig;
  onAuthenticated: (session: Session) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  return (
    <main className="auth-layout">
      <section className="auth-brand" aria-label="Wealthboard">
        <div className="brand-mark">
          <CircleDollarSign aria-hidden />
        </div>
        <p className="eyebrow">Private wealth</p>
        <h1>Wealthboard</h1>
        <p className="auth-copy">
          Your accounts, goals, and financial position in one focused workspace.
        </p>
      </section>
      <section className="auth-panel">
        {config.localEnabled ? (
          <>
            <div className="segmented" aria-label="Authentication mode">
              <button
                className={mode === "login" ? "active" : ""}
                onClick={() => setMode("login")}
              >
                Sign in
              </button>
              <button
                className={mode === "signup" ? "active" : ""}
                onClick={() => setMode("signup")}
              >
                Create account
              </button>
            </div>
            {mode === "login" ? (
              <LoginForm onAuthenticated={onAuthenticated} />
            ) : (
              <SignupForm onAuthenticated={onAuthenticated} />
            )}
          </>
        ) : null}
        {config.oidcEnabled ? (
          <a className="oidc-button" href="/api/v1/auth/oidc/start">
            <ShieldCheck size={18} /> Continue with{" "}
            {config.providerName || "SSO"}
          </a>
        ) : null}
      </section>
    </main>
  );
}

function LoginForm({
  onAuthenticated,
}: {
  onAuthenticated: (session: Session) => void;
}) {
  const [error, setError] = useState("");
  const { register, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });
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
      <div>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          autoComplete="username"
          {...register("username")}
        />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="primary-button"
        disabled={formState.isSubmitting}
        type="submit"
      >
        {formState.isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

function SignupForm({
  onAuthenticated,
}: {
  onAuthenticated: (session: Session) => void;
}) {
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
      setError(
        caught instanceof Error ? caught.message : "Account creation failed.",
      );
    }
  });
  return (
    <form onSubmit={submit} className="auth-form">
      <div className="form-grid">
        <div>
          <label htmlFor="signup-username">Username</label>
          <input
            id="signup-username"
            autoComplete="username"
            {...register("username")}
          />
        </div>
        <div>
          <label htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            autoComplete="name"
            {...register("displayName")}
          />
        </div>
      </div>
      <div>
        <label htmlFor="base-currency">Base currency</label>
        <input id="base-currency" maxLength={3} {...register("baseCurrency")} />
      </div>
      <div className="form-grid">
        <div>
          <label htmlFor="new-password">Password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            {...register("password")}
          />
        </div>
        <div>
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
        </div>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="primary-button"
        disabled={formState.isSubmitting}
        type="submit"
      >
        {formState.isSubmitting ? "Creating..." : "Create account"}
      </button>
    </form>
  );
}

function AuthenticatedApp({
  session,
  onSignedOut,
}: {
  session: Session;
  onSignedOut: () => void;
}) {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState("");
  useEffect(() => {
    void getOverview()
      .then(setOverview)
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : "Overview unavailable.",
        ),
      );
  }, []);

  const signOut = async () => {
    await logout(session.csrfToken);
    clearUserState();
    onSignedOut();
  };
  const appName = overview?.settings.appName ?? "Wealthboard";
  const displayName = overview?.settings.displayName ?? session.user.username;

  if (error)
    return (
      <main className="content">
        <div className="notice error" role="alert">
          {error}
        </div>
      </main>
    );
  if (!overview) return <LoadingScreen />;

  return (
    <AppShell
      session={session}
      appName={appName}
      displayName={displayName}
      onSignOut={signOut}
    >
      <Suspense fallback={<RouteLoadingScreen />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route
            path="/accounts"
            element={<AccountsPage session={session} />}
          />
          <Route
            path="/accounts/:id"
            element={<AccountDetailPage session={session} />}
          />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/goals" element={<GoalsPage session={session} />} />
          <Route
            path="/goals/:id"
            element={<GoalDetailPage session={session} />}
          />
          <Route path="/reports" element={<ReportsPage />} />
          <Route
            path="/categories"
            element={<CategoriesPage session={session} />}
          />
          <Route
            path="/institutions"
            element={<InstitutionsPage session={session} />}
          />
          <Route
            path="/instruments"
            element={<InstrumentsPage session={session} />}
          />
          <Route
            path="/instruments/:id"
            element={<InstrumentDetailPage session={session} />}
          />
          <Route path="/estate" element={<EstatePage session={session} />} />
          <Route
            path="/estate/snapshots/:id"
            element={<EstateSnapshotPage />}
          />
          <Route path="/review" element={<ReviewPage session={session} />} />
          <Route
            path="/settings"
            element={<SettingsPage session={session} />}
          />
          <Route path="/offline" element={<OfflinePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <CircleDollarSign />
      <span>Loading Wealthboard</span>
    </main>
  );
}

function RouteLoadingScreen() {
  return (
    <div className="loading-screen" role="status">
      <CircleDollarSign />
      <span>Loading view</span>
    </div>
  );
}
