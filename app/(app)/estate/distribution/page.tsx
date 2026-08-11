import { ListPlus } from "lucide-react";

import { EstateDistributionWorkspace } from "@/components/estate-distribution-workspace";
import { EstateNavigation } from "@/components/estate-navigation";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getEstateWorkspace } from "@/lib/services/estate-planning";

export const metadata = { title: "Estate distribution" };

export default async function EstateDistributionPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { userId } = await requireSession();
  const [workspace, query] = await Promise.all([
    Promise.resolve(getEstateWorkspace(userId)),
    searchParams,
  ]);
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
      <EstateDistributionWorkspace
        workspace={workspace}
        selectedAccountId={query.account}
      />
    </>
  );
}
