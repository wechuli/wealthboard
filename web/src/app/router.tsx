import { CircleDollarSign } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import {
  ApiError,
  getAuthConfig,
  getOverview,
  getSession,
  login,
  logout,
  signup,
} from "@/api/client";
import { LoginScreen, SignupScreen } from "@/components/auth/auth";
import { OfflinePage } from "@/pages/offline";
import { AppShell } from "@/components/layout/app-shell";
import type { AuthConfig, Overview, Session } from "@/lib/types";

const CoreRoutes = lazy(() => import("@/pages/core-routes"));
const PlanningRoutes = lazy(() => import("@/pages/planning-routes"));
const EstateRoutes = lazy(() => import("@/pages/estate-routes"));
const ReviewRoute = lazy(() => import("@/pages/review-route"));
const SettingsRoute = lazy(() => import("@/pages/settings-route"));

export function PortedApp() {
  const { pathname } = useLocation();
  const [session, setSession] = useState<Session | null | undefined>();
  const [authConfig, setAuthConfig] = useState<AuthConfig>();

  useEffect(() => {
    void getAuthConfig().then(setAuthConfig);
    void getSession()
      .then(setSession)
      .catch((error: unknown) => {
        setSession(
          error instanceof ApiError && error.status === 401 ? null : undefined,
        );
      });
  }, []);

  if (session === undefined || !authConfig) return <LoadingScreen />;
  if (session === null) {
    if (pathname === "/signup" && authConfig.localEnabled) {
      return (
        <SignupScreen authenticate={signup} onAuthenticated={setSession} />
      );
    }
    return (
      <LoginScreen
        config={authConfig}
        authenticate={login}
        onAuthenticated={setSession}
      />
    );
  }

  return (
    <AuthenticatedRoutes
      session={session}
      onSignedOut={() => setSession(null)}
    />
  );
}

function AuthenticatedRoutes({
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

  if (error) {
    return (
      <main className="financial-grid flex min-h-screen items-center justify-center px-5">
        <div
          className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      </main>
    );
  }
  if (!overview) return <LoadingScreen />;

  const signOut = async () => {
    await logout(session.csrfToken);
    onSignedOut();
  };

  return (
    <AppShell
      session={session}
      appName={overview.settings.appName}
      displayName={overview.settings.displayName}
      onSignOut={signOut}
    >
      <Suspense fallback={<RouteLoadingScreen />}>
        <Routes>
          <Route path="/" element={<CoreRoutes session={session} />} />
          <Route path="/accounts/*" element={<CoreRoutes session={session} />} />
          <Route path="/transactions/*" element={<CoreRoutes session={session} />} />
          <Route path="/goals/*" element={<PlanningRoutes session={session} />} />
          <Route path="/reports" element={<PlanningRoutes session={session} />} />
          <Route path="/categories" element={<PlanningRoutes session={session} />} />
          <Route path="/institutions" element={<PlanningRoutes session={session} />} />
          <Route path="/instruments/*" element={<PlanningRoutes session={session} />} />
          <Route path="/estate/*" element={<EstateRoutes session={session} />} />
          <Route path="/review" element={<ReviewRoute session={session} />} />
          <Route path="/settings" element={<SettingsRoute session={session} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/signup" element={<Navigate to="/" replace />} />
          <Route path="/offline" element={<OfflinePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function LoadingScreen() {
  return (
    <main className="financial-grid flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 text-slate-400" role="status">
        <CircleDollarSign className="text-emerald-300" />
        <span>Loading Wealthboard</span>
      </div>
    </main>
  );
}

function RouteLoadingScreen() {
  return (
    <div className="flex min-h-56 items-center justify-center gap-3 text-slate-400" role="status">
      <CircleDollarSign className="text-emerald-300" />
      <span>Loading view</span>
    </div>
  );
}
