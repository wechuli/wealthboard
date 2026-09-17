import Link from "next/link";
import { ArchiveRestore, Edit3, Plus, Trash2 } from "lucide-react";

import {
  archiveInvestmentInstrumentAction,
  deleteInvestmentInstrumentAction,
} from "@/app/(app)/actions";
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
        description="Manage the stocks, ETFs, and funds used by your position accounts."
        actions={
          <Button asChild>
            <Link href="/instruments/new">
              <Plus size={17} />
              Add instrument
            </Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Instrument directory</CardTitle>
        </CardHeader>
        <CardContent>
          {!instruments.length ? (
            <p className="py-12 text-center text-sm text-slate-500">
              No instruments yet. Add one to make it available to your position
              accounts.
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
                  <div className="flex shrink-0 items-center gap-2">
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
                    <MutationButton
                      action={deleteInvestmentInstrumentAction.bind(
                        null,
                        instrument.id,
                      )}
                      confirm={`Permanently delete ${instrument.name} and all its saved prices? This cannot be undone. Instruments linked to account history cannot be deleted.`}
                      successMessage="Instrument permanently deleted."
                      variant="ghost"
                      size="icon"
                      className="text-red-300 hover:text-red-200"
                      aria-label={`Delete ${instrument.name}`}
                      title={`Permanently delete ${instrument.name}`}
                    >
                      <Trash2 size={15} />
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
