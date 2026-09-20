import { Route, Routes } from "react-router-dom";

import {
  EstateBeneficiariesPage,
  EstateDistributionPage,
  EstateIndexPage,
  EstateSnapshotPage,
  EstateSummaryPage,
} from "@/pages/estate";
import type { Session } from "@/lib/types";

export default function EstateRoutes({ session }: { session: Session }) {
  return (
    <Routes>
      <Route path="/estate" element={<EstateIndexPage />} />
      <Route path="/estate/beneficiaries" element={<EstateBeneficiariesPage session={session} />} />
      <Route path="/estate/distribution" element={<EstateDistributionPage session={session} />} />
      <Route path="/estate/summary" element={<EstateSummaryPage session={session} />} />
      <Route path="/estate/snapshots/:id" element={<EstateSnapshotPage />} />
    </Routes>
  );
}
