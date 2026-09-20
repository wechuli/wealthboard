import { CircleDollarSign } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
} from "react";
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

type SessionPageProps = { session: Session };

function lazyNamed<Props>(loader: () => Promise<unknown>, name: string) {
  return lazy(async () => {
    const loaded = (await loader()) as Record<string, ComponentType<Props>>;
    return { default: loaded[name] };
  });
}

const loadCore = () => import("@/pages/core");
const DashboardPage = lazyNamed<Record<string, never>>(loadCore, "DashboardPage");
const AccountsPage = lazyNamed<Record<string, never>>(loadCore, "AccountsPage");
const AccountDetailPage = lazyNamed<SessionPageProps>(loadCore, "AccountDetailPage");
const NewAccountPage = lazyNamed<SessionPageProps>(loadCore, "NewAccountPage");
const ArchivedAccountsPage = lazyNamed<SessionPageProps>(loadCore, "ArchivedAccountsPage");
const EditAccountPage = lazyNamed<SessionPageProps>(loadCore, "EditAccountPage");
const ValuationPage = lazyNamed<SessionPageProps>(loadCore, "ValuationPage");
const ConvertAccountPage = lazyNamed<SessionPageProps>(loadCore, "ConvertAccountPage");
const AccountImportPage = lazyNamed<SessionPageProps>(loadCore, "AccountHistoryImportPage");
const InvestmentActionsPage = lazyNamed<SessionPageProps>(loadCore, "InvestmentActionsPage");
const NewAccountInstrumentPage = lazyNamed<SessionPageProps>(loadCore, "NewAccountInstrumentPage");
const NewPositionEventPage = lazyNamed<SessionPageProps>(loadCore, "NewPositionEventPage");
const EditPositionEventPage = lazyNamed<SessionPageProps>(loadCore, "EditPositionEventPage");
const NewSecurityPricePage = lazyNamed<SessionPageProps>(loadCore, "NewSecurityPricePage");
const ReconcilePage = lazyNamed<SessionPageProps>(loadCore, "ReconcilePositionAccountPage");
const TransactionsPage = lazyNamed<SessionPageProps>(loadCore, "TransactionsPage");
const NewTransactionPage = lazyNamed<SessionPageProps>(loadCore, "NewTransactionPage");
const EditTransactionPage = lazyNamed<SessionPageProps>(loadCore, "EditTransactionPage");

const loadPlanning = () => import("@/pages/planning");
const GoalsPage = lazyNamed<SessionPageProps>(loadPlanning, "GoalsPage");
const NewGoalPage = lazyNamed<SessionPageProps>(loadPlanning, "NewGoalPage");
const GoalDetailPage = lazyNamed<SessionPageProps>(loadPlanning, "GoalDetailPage");
const EditGoalPage = lazyNamed<SessionPageProps>(loadPlanning, "EditGoalPage");
const ReportsPage = lazyNamed<Record<string, never>>(loadPlanning, "ReportsPage");
const CategoriesPage = lazyNamed<SessionPageProps>(loadPlanning, "CategoriesPage");
const InstitutionsPage = lazyNamed<SessionPageProps>(loadPlanning, "InstitutionsPage");
const InstrumentsPage = lazyNamed<SessionPageProps>(loadPlanning, "InstrumentsPage");
const NewInstrumentPage = lazyNamed<SessionPageProps>(loadPlanning, "NewInstrumentPage");
const EditInstrumentPage = lazyNamed<SessionPageProps>(loadPlanning, "EditInstrumentPage");

const loadEstate = () => import("@/pages/estate");
const EstateIndexPage = lazyNamed<Record<string, never>>(loadEstate, "EstateIndexPage");
const EstateBeneficiariesPage = lazyNamed<SessionPageProps>(loadEstate, "EstateBeneficiariesPage");
const EstateDistributionPage = lazyNamed<SessionPageProps>(loadEstate, "EstateDistributionPage");
const EstateSummaryPage = lazyNamed<SessionPageProps>(loadEstate, "EstateSummaryPage");
const EstateSnapshotPage = lazyNamed<Record<string, never>>(loadEstate, "EstateSnapshotPage");
const ReviewPage = lazyNamed<SessionPageProps>(() => import("@/pages/review"), "PortfolioReviewPage");
const SettingsPage = lazyNamed<SessionPageProps>(() => import("@/pages/settings"), "SettingsPage");

export function App() {
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
          <Route path="/" element={<DashboardPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/accounts/new" element={<NewAccountPage session={session} />} />
          <Route path="/accounts/archived" element={<ArchivedAccountsPage session={session} />} />
          <Route path="/accounts/:id" element={<AccountDetailPage session={session} />} />
          <Route path="/accounts/:id/edit" element={<EditAccountPage session={session} />} />
          <Route path="/accounts/:id/valuation" element={<ValuationPage session={session} />} />
          <Route path="/accounts/:id/convert" element={<ConvertAccountPage session={session} />} />
          <Route path="/accounts/:id/import" element={<AccountImportPage session={session} />} />
          <Route path="/accounts/:id/investment-actions" element={<InvestmentActionsPage session={session} />} />
          <Route path="/accounts/:id/instruments/new" element={<NewAccountInstrumentPage session={session} />} />
          <Route path="/accounts/:id/positions/new" element={<NewPositionEventPage session={session} />} />
          <Route path="/accounts/:id/positions/:eventId/edit" element={<EditPositionEventPage session={session} />} />
          <Route path="/accounts/:id/prices/new" element={<NewSecurityPricePage session={session} />} />
          <Route path="/accounts/:id/reconcile" element={<ReconcilePage session={session} />} />
          <Route path="/transactions" element={<TransactionsPage session={session} />} />
          <Route path="/transactions/new" element={<NewTransactionPage session={session} />} />
          <Route path="/transactions/:id/edit" element={<EditTransactionPage session={session} />} />
          <Route path="/goals" element={<GoalsPage session={session} />} />
          <Route path="/goals/new" element={<NewGoalPage session={session} />} />
          <Route path="/goals/:id" element={<GoalDetailPage session={session} />} />
          <Route path="/goals/:id/edit" element={<EditGoalPage session={session} />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/categories" element={<CategoriesPage session={session} />} />
          <Route path="/institutions" element={<InstitutionsPage session={session} />} />
          <Route path="/instruments" element={<InstrumentsPage session={session} />} />
          <Route path="/instruments/new" element={<NewInstrumentPage session={session} />} />
          <Route path="/instruments/:id/edit" element={<EditInstrumentPage session={session} />} />
          <Route path="/estate" element={<EstateIndexPage />} />
          <Route path="/estate/beneficiaries" element={<EstateBeneficiariesPage session={session} />} />
          <Route path="/estate/distribution" element={<EstateDistributionPage session={session} />} />
          <Route path="/estate/summary" element={<EstateSummaryPage session={session} />} />
          <Route path="/estate/snapshots/:id" element={<EstateSnapshotPage />} />
          <Route path="/review" element={<ReviewPage session={session} />} />
          <Route path="/settings" element={<SettingsPage session={session} />} />
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
    <div
      className="flex min-h-56 items-center justify-center gap-3 text-slate-400"
      role="status"
    >
      <CircleDollarSign className="text-emerald-300" />
      <span>Loading view</span>
    </div>
  );
}
