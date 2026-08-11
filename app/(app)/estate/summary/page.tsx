import { EstateNavigation } from "@/components/estate-navigation";
import { EstateSummaryWorkspace } from "@/components/estate-summary-workspace";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getEstateWorkspace } from "@/lib/services/estate-planning";

export const metadata = { title: "Estate planning summary" };

export default async function EstateSummaryPage() {
  const { userId } = await requireSession();
  const workspace = getEstateWorkspace(userId);
  return (
    <>
      <PageHeader
        title="Estate planning summary"
        description="Review estimated values, unresolved decisions, beneficiary totals, and retained as-of documents."
      />
      <EstateNavigation />
      <div className="mb-5 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] p-4 text-sm text-cyan-100">
        This is a Will Preparation Worksheet and Estate Planning Summary, not a legally executed will.
        Reconcile it with locally valid documents and institution-held designations.
      </div>
      <EstateSummaryWorkspace workspace={workspace} />
    </>
  );
}