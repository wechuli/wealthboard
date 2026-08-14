import Link from "next/link";
import { Edit3, ArchiveRestore } from "lucide-react";

import { archiveInvestmentInstrumentAction } from "@/app/(app)/actions";
import { MutationButton } from "@/components/mutation-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { requireSession } from "@/lib/auth/session";
import { listInvestmentInstruments } from "@/lib/services/investments";

export const metadata = { title: "Investment instruments" };

export default async function InstrumentsPage() {
  const { userId } = await requireSession();
  const instruments = listInvestmentInstruments(userId, {
    includeArchived: true,
  });
  return (
    <>
      <PageHeader
        title="Investment instruments"
        description="Owner-scoped stocks, ETFs, and funds referenced by position accounts."
      />
      <Card>
        <CardHeader>
          <CardTitle>Instrument directory</CardTitle>
        </CardHeader>
        <CardContent>
          {!instruments.length ? (
            <p className="py-12 text-center text-sm text-slate-500">
              Instruments are created from a position account.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {instruments.map((instrument) => (
                <div
                  key={instrument.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-slate-100">
                        {instrument.name}
                      </p>
                      {instrument.archivedAt ? <Badge>Archived</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {instrument.symbol ||
                        instrument.identifier ||
                        "Custom instrument"}{" "}
                      · {instrument.assetType.toUpperCase()} ·{" "}
                      {instrument.quoteCurrency}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${instrument.name}`}
                    >
                      <Link href={`/instruments/${instrument.id}/edit`}>
                        <Edit3 size={15} />
                      </Link>
                    </Button>
                    <MutationButton
                      action={archiveInvestmentInstrumentAction.bind(
                        null,
                        instrument.id,
                        !instrument.archivedAt,
                      )}
                      confirm={
                        instrument.archivedAt
                          ? "Restore this instrument?"
                          : "Archive this instrument? Every holding must be closed."
                      }
                      successMessage={
                        instrument.archivedAt
                          ? "Instrument restored."
                          : "Instrument archived."
                      }
                      variant="ghost"
                      size="icon"
                      aria-label={
                        instrument.archivedAt
                          ? "Restore instrument"
                          : "Archive instrument"
                      }
                    >
                      <ArchiveRestore size={15} />
                    </MutationButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
