import { Route, Routes } from "react-router-dom";

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
  PortedNewInstrumentPage,
  PortedNewPositionEventPage,
  PortedNewSecurityPricePage,
  PortedNewTransactionPage,
  PortedReconcilePositionAccountPage,
  PortedTransactionsPage,
  PortedValuationPage,
} from "@/pages/core";
import type { Session } from "@/lib/types";

export default function CoreRoutes({ session }: { session: Session }) {
  return (
    <Routes>
      <Route path="/" element={<PortedDashboardPage />} />
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
        element={<PortedNewInstrumentPage session={session} />}
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
    </Routes>
  );
}
