import { CircleDollarSign } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import {
  ApiError,
  getAuthConfig,
  getOverview,
  getSession,
  login,
  logout,
  signup,
} from "./api";
import {
  EstateBeneficiariesPage,
  EstateDistributionPage,
  EstateIndexPage,
  EstateSnapshotPage,
  EstateSummaryPage,
} from "./estate-pages";
import { OriginalPortfolioReviewPage } from "./original-review-page";
import { OriginalSettingsPage } from "./original-settings-page";
import {
  PortedAccountDetailPage,
  PortedAccountHistoryImportPage,
  PortedAccountsPage,
  PortedArchivedAccountsPage,
  PortedConvertAccountPage,
  PortedDashboardPage,
  PortedEditAccountPage,
  PortedEditPositionEventPage,
  PortedEditTransactionPage,
  PortedInvestmentActionsPage,
  PortedNewAccountPage,
  PortedNewInstrumentPage as PortedNewAccountInstrumentPage,
  PortedNewPositionEventPage,
  PortedNewSecurityPricePage,
  PortedNewTransactionPage,
  PortedReconcilePositionAccountPage,
  PortedTransactionsPage,
  PortedValuationPage,
} from "./ported-core-pages";
import {
  PortedCategoriesPage,
  PortedEditGoalPage,
  PortedEditInstrumentPage,
  PortedGoalDetailPage,
  PortedGoalsPage,
  PortedInstitutionsPage,
  PortedInstrumentsPage,
  PortedNewGoalPage,
  PortedNewInstrumentPage,
  PortedReportsPage,
} from "./ported-planning-pages";
import { LoginScreen, SignupScreen } from "./ported-ui/auth";
import { OfflinePage } from "./pwa";
import { AppShell } from "./shell";
import type { AuthConfig, Overview, Session } from "./types";

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
      <Routes>
        <Route path="/" element={<PortedDashboardPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/signup" element={<Navigate to="/" replace />} />

        <Route path="/accounts" element={<PortedAccountsPage />} />
        <Route
          path="/accounts/new"
          element={<PortedNewAccountPage session={session} />}
        />
        <Route
          path="/accounts/archived"
          element={<PortedArchivedAccountsPage session={session} />}
        />
        <Route
          path="/accounts/:id"
          element={<PortedAccountDetailPage session={session} />}
        />
        <Route
          path="/accounts/:id/edit"
          element={<PortedEditAccountPage session={session} />}
        />
        <Route
          path="/accounts/:id/valuation"
          element={<PortedValuationPage session={session} />}
        />
        <Route
          path="/accounts/:id/convert"
          element={<PortedConvertAccountPage session={session} />}
        />
        <Route
          path="/accounts/:id/import"
          element={<PortedAccountHistoryImportPage session={session} />}
        />
        <Route
          path="/accounts/:id/investment-actions"
          element={<PortedInvestmentActionsPage session={session} />}
        />
        <Route
          path="/accounts/:id/instruments/new"
          element={<PortedNewAccountInstrumentPage session={session} />}
        />
        <Route
          path="/accounts/:id/positions/new"
          element={<PortedNewPositionEventPage session={session} />}
        />
        <Route
          path="/accounts/:id/positions/:eventId/edit"
          element={<PortedEditPositionEventPage session={session} />}
        />
        <Route
          path="/accounts/:id/prices/new"
          element={<PortedNewSecurityPricePage session={session} />}
        />
        <Route
          path="/accounts/:id/reconcile"
          element={<PortedReconcilePositionAccountPage session={session} />}
        />

        <Route
          path="/transactions"
          element={<PortedTransactionsPage session={session} />}
        />
        <Route
          path="/transactions/new"
          element={<PortedNewTransactionPage session={session} />}
        />
        <Route
          path="/transactions/:id/edit"
          element={<PortedEditTransactionPage session={session} />}
        />

        <Route path="/goals" element={<PortedGoalsPage session={session} />} />
        <Route
          path="/goals/new"
          element={<PortedNewGoalPage session={session} />}
        />
        <Route
          path="/goals/:id"
          element={<PortedGoalDetailPage session={session} />}
        />
        <Route
          path="/goals/:id/edit"
          element={<PortedEditGoalPage session={session} />}
        />
        <Route path="/reports" element={<PortedReportsPage />} />
        <Route
          path="/categories"
          element={<PortedCategoriesPage session={session} />}
        />
        <Route
          path="/institutions"
          element={<PortedInstitutionsPage session={session} />}
        />
        <Route
          path="/instruments"
          element={<PortedInstrumentsPage session={session} />}
        />
        <Route
          path="/instruments/new"
          element={<PortedNewInstrumentPage session={session} />}
        />
        <Route
          path="/instruments/:id/edit"
          element={<PortedEditInstrumentPage session={session} />}
        />

        <Route path="/estate" element={<EstateIndexPage />} />
        <Route
          path="/estate/beneficiaries"
          element={<EstateBeneficiariesPage session={session} />}
        />
        <Route
          path="/estate/distribution"
          element={<EstateDistributionPage session={session} />}
        />
        <Route
          path="/estate/summary"
          element={<EstateSummaryPage session={session} />}
        />
        <Route path="/estate/snapshots/:id" element={<EstateSnapshotPage />} />

        <Route
          path="/review"
          element={<OriginalPortfolioReviewPage session={session} />}
        />
        <Route
          path="/settings"
          element={<OriginalSettingsPage session={session} />}
        />
        <Route path="/offline" element={<OfflinePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
