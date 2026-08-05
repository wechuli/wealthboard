import { InstitutionManager } from "@/components/institution-manager";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { listInstitutions } from "@/lib/services/institutions";

export const metadata = { title: "Institutions" };

export default async function InstitutionsPage() {
  const { userId } = await requireSession();
  const institutions = await listInstitutions(userId, {
    includeArchived: true,
  });

  return (
    <>
      <PageHeader
        title="Institutions"
        description="Manage the providers linked to your financial accounts."
      />
      <InstitutionManager institutions={institutions} />
    </>
  );
}
