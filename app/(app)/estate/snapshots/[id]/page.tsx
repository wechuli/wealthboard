import { notFound } from "next/navigation";

import { EstateSummaryDocument } from "@/components/estate-summary-document";
import { requireSession } from "@/lib/auth/session";
import { getEstatePlanSnapshot } from "@/lib/services/estate-planning";

export const metadata = {
  title: "Estate Planning Summary",
  robots: { index: false, follow: false },
};

export default async function EstateSnapshotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await requireSession();
  const snapshot = getEstatePlanSnapshot(userId, (await params).id);
  if (!snapshot) notFound();
  return (
    <EstateSummaryDocument
      snapshotId={snapshot.id}
      content={snapshot.content}
      contentHash={snapshot.contentHash}
    />
  );
}