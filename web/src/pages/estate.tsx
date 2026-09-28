import { ListPlus } from "lucide-react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useState } from "react";

import {
  getAccounts,
  getEstate,
  getEstateSnapshot,
  getOverview,
} from "@/api/client";
import { BeneficiaryManager } from "@/components/estate/beneficiary-manager";
import { EstateDistributionWorkspace } from "@/components/estate/distribution-workspace";
import { EstateNavigation } from "@/components/estate/navigation";
import {
  EstateSummaryDocument,
  normalizeEstateSnapshot,
} from "@/components/estate/summary-document";
import { EstateSummaryWorkspace } from "@/components/estate/summary-workspace";
import { PageHeader } from "@/components/ui/estate";
import { buildEstateViewWorkspace } from "@/components/estate/view-model";
import type { Session } from "@/lib/types";
import { ResourceView } from "@/components/ui/resource";
import { useResource } from "@/hooks/use-resource";

export function EstateIndexPage() {
  return <Navigate to="/estate/distribution" replace />;
}

export function EstateBeneficiariesPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(getEstate, [refresh]);
  return (
    <>
      <PageHeader
        title="Beneficiaries"
        description="Maintain the people, organizations, and trusts referenced by your estate plan."
      />
      <EstateNavigation />
      <div className="mb-5 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] p-4 text-sm text-cyan-100">
        Beneficiaries are private planning records. They do not become
        Wealthboard users, account owners, or authorized viewers.
      </div>
      <ResourceView state={state} loadingLabel="Loading beneficiaries...">
        {(estate) => (
          <BeneficiaryManager
            beneficiaries={estate.beneficiaries}
            session={session}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        )}
      </ResourceView>
    </>
  );
}

function useEstateWorkspace(refresh: number) {
  return useResource(async () => {
    const [estate, accounts, overview] = await Promise.all([
      getEstate(),
      getAccounts(),
      getOverview(),
    ]);
    return buildEstateViewWorkspace(estate, accounts.items, overview.settings);
  }, [refresh]);
}

export function EstateDistributionPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const [searchParams] = useSearchParams();
  const state = useEstateWorkspace(refresh);
  return (
    <>
      <PageHeader
        title="Estate distribution"
        description="Describe how each asset is held, then assign exact primary and contingent shares."
      />
      <EstateNavigation />
      <div className="mb-5 flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-4 text-sm text-amber-100">
        <ListPlus size={18} className="mt-0.5 shrink-0" />
        <p>
          This plan records intent only. It does not change ownership, register
          a provider beneficiary, or transfer property.
        </p>
      </div>
      <ResourceView state={state} loadingLabel="Loading estate distribution...">
        {(workspace) => (
          <EstateDistributionWorkspace
            workspace={workspace}
            selectedAccountId={searchParams.get("account") ?? undefined}
            session={session}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        )}
      </ResourceView>
    </>
  );
}

export function EstateSummaryPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useEstateWorkspace(refresh);
  return (
    <>
      <PageHeader
        title="Estate planning summary"
        description="Review estimated values, unresolved decisions, beneficiary totals, and retained as-of documents."
      />
      <EstateNavigation />
      <div className="mb-5 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] p-4 text-sm text-cyan-100">
        This is a Will Preparation Worksheet and Estate Planning Summary, not a
        legally executed will. Reconcile it with locally valid documents and
        institution-held designations.
      </div>
      <ResourceView state={state} loadingLabel="Loading estate summary...">
        {(workspace) => (
          <EstateSummaryWorkspace
            workspace={workspace}
            session={session}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        )}
      </ResourceView>
    </>
  );
}

export function EstateSnapshotPage() {
  const { id = "" } = useParams();
  const state = useResource(() => getEstateSnapshot(id), [id]);
  return (
    <ResourceView state={state} loadingLabel="Loading estate summary...">
      {(snapshot) => (
        <EstateSummaryDocument
          snapshotId={snapshot.id}
          content={normalizeEstateSnapshot(snapshot)}
          contentHash={snapshot.contentHash}
        />
      )}
    </ResourceView>
  );
}
