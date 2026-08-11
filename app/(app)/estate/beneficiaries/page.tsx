import { BeneficiaryManager } from "@/components/beneficiary-manager";
import { EstateNavigation } from "@/components/estate-navigation";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { getEstateWorkspace } from "@/lib/services/estate-planning";

export const metadata = { title: "Estate beneficiaries" };

export default async function EstateBeneficiariesPage() {
  const { userId } = await requireSession();
  const workspace = getEstateWorkspace(userId);
  return (
    <>
      <PageHeader
        title="Beneficiaries"
        description="Maintain the people, organizations, and trusts referenced by your estate plan."
      />
      <EstateNavigation />
      <div className="mb-5 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.07] p-4 text-sm text-cyan-100">
        Beneficiaries are private planning records. They do not become Wealthboard users,
        account owners, or authorized viewers.
      </div>
      <BeneficiaryManager beneficiaries={workspace.beneficiaries} />
    </>
  );
}