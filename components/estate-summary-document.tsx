"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";

import { MoneyValue } from "@/components/privacy-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form-controls";
import type { EstateSnapshotContent } from "@/lib/services/estate-planning";

function OptionalMoney({
  amount,
  currency,
  visible,
}: {
  amount: string | null;
  currency: string;
  visible: boolean;
}) {
  if (!visible || amount === null) {
    return <span className="text-slate-500">{amount === null ? "Rate unavailable" : "Value excluded"}</span>;
  }
  return <MoneyValue amount={BigInt(amount)} currency={currency} />;
}

export function EstateSummaryDocument({
  snapshotId,
  content,
  contentHash,
}: {
  snapshotId: string;
  content: EstateSnapshotContent;
  contentHash: string;
}) {
  const [includeValues, setIncludeValues] = useState(false);
  const [includeContacts, setIncludeContacts] = useState(false);
  const [includeReferences, setIncludeReferences] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);

  return (
    <div>
      <div className="estate-print-controls mb-5 rounded-xl border border-white/10 bg-[var(--panel)] p-4">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h1 className="font-semibold text-slate-100">Print controls</h1>
            <p className="mt-1 text-sm text-slate-400">
              Sensitive fields remain excluded until selected. Global privacy mode still masks values.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={16} /> Print or save PDF
            </Button>
            <Button asChild variant="outline">
              <a href={`/api/estate/snapshots/${snapshotId}`}>
                <Download size={16} /> Download JSON
              </a>
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-x-5 sm:grid-cols-2 lg:grid-cols-4">
          <Checkbox
            label="Include exact values"
            checked={includeValues}
            onChange={(event) => setIncludeValues(event.target.checked)}
          />
          <Checkbox
            label="Include contacts"
            checked={includeContacts}
            onChange={(event) => setIncludeContacts(event.target.checked)}
          />
          <Checkbox
            label="Include account references"
            checked={includeReferences}
            onChange={(event) => setIncludeReferences(event.target.checked)}
          />
          <Checkbox
            label="Include private notes"
            checked={includeNotes}
            onChange={(event) => setIncludeNotes(event.target.checked)}
          />
        </div>
      </div>

      <article className="estate-print-document mx-auto max-w-5xl bg-white p-6 text-slate-950 shadow-2xl sm:p-10">
        <header className="border-b-2 border-slate-900 pb-6">
          <p className="text-xs font-bold uppercase text-emerald-700">Estate Planning Summary</p>
          <h1 className="mt-2 text-3xl font-bold">{content.plan.title}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Prepared for {content.ownerDisplayName} · Values as of {content.valueAsOfDate} · Generated {new Date(content.generatedAt).toLocaleString()}
          </p>
          {content.plan.jurisdiction ? (
            <p className="mt-1 text-sm text-slate-600">Jurisdiction reference: {content.plan.jurisdiction}</p>
          ) : null}
        </header>

        <section className="my-6 border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>Planning document only.</strong> {content.disclaimer} It does not address witnessing,
          capacity, probate, guardianship, trusts, taxes, or other jurisdiction-specific requirements.
        </section>

        <section className="print-break-inside-avoid">
          <h2 className="text-lg font-bold">Estate estimate</h2>
          <div className="mt-3 grid grid-cols-3 border-y border-slate-300 py-4 text-sm">
            <div>
              <p className="text-slate-500">Gross assets</p>
              <p className="mt-1 font-bold">
                <OptionalMoney amount={content.totals.grossAssetsBaseMinor} currency={content.baseCurrency} visible={includeValues} />
              </p>
            </div>
            <div>
              <p className="text-slate-500">Liabilities</p>
              <p className="mt-1 font-bold">
                <OptionalMoney amount={content.totals.liabilitiesBaseMinor} currency={content.baseCurrency} visible={includeValues} />
              </p>
            </div>
            <div>
              <p className="text-slate-500">Estimated net estate</p>
              <p className="mt-1 font-bold">
                <OptionalMoney amount={content.totals.netEstateBaseMinor} currency={content.baseCurrency} visible={includeValues} />
              </p>
            </div>
          </div>
          {!content.totals.complete ? (
            <p className="mt-2 text-sm font-medium text-amber-800">Totals are incomplete because one or more exchange rates are unavailable.</p>
          ) : null}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">Asset directions</h2>
          <div className="mt-3 space-y-5">
            {content.assets.filter((asset) => asset.isIncluded).map((asset) => (
              <section key={asset.id} className="print-break-inside-avoid border-t border-slate-300 pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold">{asset.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {asset.categoryName} · Ownership share {(asset.ownershipShareBps / 100).toFixed(2)}% · {asset.transferContext.replaceAll("_", " ")} · {asset.distributionMethod.replaceAll("_", " ")}
                    </p>
                    {includeReferences && asset.accountReference ? (
                      <p className="mt-1 text-sm">Account reference: {asset.accountReference}</p>
                    ) : null}
                    {includeReferences && asset.documentReference ? (
                      <p className="mt-1 text-sm">Document reference: {asset.documentReference}</p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-sm font-bold">
                    <OptionalMoney amount={asset.estateValueMinor} currency={asset.currency} visible={includeValues} />
                  </p>
                </div>
                {includeNotes && asset.notes ? <p className="mt-2 text-sm text-slate-700">{asset.notes}</p> : null}
                <table className="mt-3 w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-300 text-xs uppercase text-slate-500">
                      <th className="py-2">Beneficiary</th>
                      <th className="py-2">Priority</th>
                      <th className="py-2 text-right">Share</th>
                      <th className="py-2 text-right">Indicative value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asset.allocations.map((allocation) => (
                      <tr key={allocation.id} className="border-b border-slate-200">
                        <td className="py-2">
                          {allocation.beneficiaryName}
                          {includeNotes && allocation.notes ? <p className="text-xs text-slate-500">{allocation.notes}</p> : null}
                        </td>
                        <td className="py-2 capitalize">{allocation.tier}</td>
                        <td className="py-2 text-right">{(allocation.allocationBps / 100).toFixed(2)}%</td>
                        <td className="py-2 text-right">
                          <OptionalMoney amount={allocation.amountMinor} currency={asset.currency} visible={includeValues} />
                        </td>
                      </tr>
                    ))}
                    {asset.residualAllocations.map((allocation) => (
                      <tr key={`residual-${allocation.id}`} className="border-b border-slate-200">
                        <td className="py-2">{allocation.beneficiaryName}</td>
                        <td className="py-2">Residual</td>
                        <td className="py-2 text-right">{(allocation.effectiveAccountBps / 100).toFixed(2)}%</td>
                        <td className="py-2 text-right">
                          <OptionalMoney amount={allocation.amountMinor} currency={asset.currency} visible={includeValues} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </section>

        <section className="mt-8 print-break-inside-avoid">
          <h2 className="text-lg font-bold">Beneficiary overview</h2>
          <div className="mt-3 divide-y divide-slate-200 border-y border-slate-300">
            {content.beneficiaries.map((beneficiary) => {
              const total = content.beneficiaryTotals.find((row) => row.beneficiaryId === beneficiary.id);
              return (
                <div key={beneficiary.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 text-sm">
                  <div>
                    <p className="font-bold">{beneficiary.name}</p>
                    <p className="capitalize text-slate-600">
                      {[beneficiary.kind, beneficiary.relationship].filter(Boolean).join(" · ")}
                    </p>
                    {includeContacts && beneficiary.contactSummary ? <p className="mt-1">{beneficiary.contactSummary}</p> : null}
                    {includeNotes && beneficiary.notes ? <p className="mt-1 text-slate-600">{beneficiary.notes}</p> : null}
                  </div>
                  <p className="font-bold">
                    <OptionalMoney amount={total?.amountBaseMinor ?? "0"} currency={content.baseCurrency} visible={includeValues} />
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-8 print-break-inside-avoid">
          <h2 className="text-lg font-bold">Liabilities</h2>
          <p className="mt-1 text-sm text-slate-600">
            Listed separately; debts are not assigned as beneficiary gifts.
          </p>
          <div className="mt-3 divide-y divide-slate-200 border-y border-slate-300">
            {content.liabilities.length ? content.liabilities.map((liability) => (
              <div key={liability.id} className="flex justify-between gap-4 py-3 text-sm">
                <span>{liability.name}</span>
                <strong><OptionalMoney amount={liability.valueMinor} currency={liability.currency} visible={includeValues} /></strong>
              </div>
            )) : <p className="py-3 text-sm text-slate-500">No active liabilities recorded.</p>}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">Review checklist</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {content.reviewItems.length ? content.reviewItems.map((item) => (
              <li key={`${item.code}-${item.accountId ?? "plan"}`} className="flex gap-2">
                <span aria-hidden>{item.severity === "blocking" ? "[ ]" : "!"}</span>
                {item.message}
              </li>
            )) : <li>No open review items were recorded.</li>}
          </ul>
        </section>

        <footer className="mt-10 border-t border-slate-300 pt-4 text-xs text-slate-500">
          Snapshot integrity hash: {contentHash}
        </footer>
      </article>
    </div>
  );
}