import { Landmark, Scale } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { api } from '@/api'
import type { EstateAllocationInput } from '@/api/types'
import { Bps, Money } from '@/components/format'
import { buttonClass, Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Notice } from '@/components/ui/Notice'
import { usePageTitle } from '@/lib/usePageTitle'
import { AssetSheet } from './AssetSheet'
import { AssetStatusBadge, ensurePlan, EstateSkeleton, TierFigure, TierMeter, useEstateView } from './kit'
import { assetStatus, type AssetRow, type EstateView } from './model'
import { TierEditor } from './TierEditor'

export default function DistributionPage() {
  usePageTitle('Distribution · Estate planning')
  const { view, isLoading, error, refetch } = useEstateView()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('account')

  if (error) return <ErrorState error={error} onRetry={refetch} title="The distribution plan couldn't be loaded" />
  if (isLoading || !view) return <EstateSkeleton rows={4} />

  const select = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('account', id)
        else next.delete('account')
        return next
      },
      { replace: !id },
    )
  const selected = selectedId ? (view.assets.find((a) => a.account.id === selectedId) ?? null) : null
  const selectedIsLiability = !!selectedId && view.liabilities.some((l) => l.id === selectedId)

  if (view.assets.length === 0 && view.liabilities.length === 0)
    return (
      <Card>
        <EmptyState
          icon={<Landmark size={22} aria-hidden />}
          title="Add the assets you want to plan for"
          action={
            <Link to="/accounts/new" className={buttonClass({ variant: 'primary' })}>
              Add an account
            </Link>
          }
        >
          Land, savings, investments, and vehicles you track in Wealthboard appear here. Then you can decide how each one is held and who receives it.
        </EmptyState>
      </Card>
    )

  return (
    <div className="flex flex-col gap-6">
      {selectedId && !selected ? (
        <Notice tone="warning" title={selectedIsLiability ? 'Liabilities are reviewed separately' : 'That account is not an active asset'} action={<Button onClick={() => select(null)}>Dismiss</Button>}>
          {selectedIsLiability ? "Debts reduce what the estate can distribute but can't be assigned as gifts." : 'Archived and unknown accounts cannot take a new directive.'}
        </Notice>
      ) : null}
      <AssetsCard view={view} onSelect={select} />
      <ResidueCard view={view} />
      <LiabilitiesCard view={view} />
      {selected ? <AssetSheet key={selected.account.id} view={view} row={selected} open onOpenChange={(open) => !open && select(null)} /> : null}
    </div>
  )
}

function AssetsCard({ view, onSelect }: { view: EstateView; onSelect(id: string): void }) {
  const included = view.assets.filter((a) => a.isIncluded)
  const settled = included.filter((a) => ['complete', 'covered'].includes(assetStatus(a, view.residuaryPrimaryBps))).length
  return (
    <Card aria-labelledby="estate-assets">
      <CardHeader
        id="estate-assets"
        title="Assets"
        description="Describe how each asset is held, then give beneficiaries exact primary and contingent shares."
        action={included.length ? <span className="num text-sm text-muted">{settled} of {included.length} fully allocated</span> : undefined}
      />
      <CardBody>
        {view.assets.length === 0 ? (
          <p className="text-sm text-muted">You have no active assets yet. Only liabilities are recorded.</p>
        ) : (
          <>
            <div className="scroll-x hidden lg:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Assets and their estate directives</caption>
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="w-[30%] min-w-48 py-2 pr-3 text-left font-medium">
                      Asset
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Value
                    </th>
                    <th scope="col" className="w-32 px-3 py-2 text-left font-medium">
                      Primary
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Contingent
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Status
                    </th>
                    <th scope="col" className="py-2 pl-3 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.assets.map((row) => (
                    <tr key={row.account.id} className="border-b border-line last:border-0">
                      <td className="py-3 pr-3">
                        <p className="font-medium text-ink [overflow-wrap:anywhere]">{row.account.name}</p>
                        <p className="truncate text-xs text-muted">
                          {row.account.categoryName}
                          {row.directive ? (
                            <>
                              {' · '}
                              <Bps value={row.directive.ownershipShareBps} /> estate share
                            </>
                          ) : null}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <Money minor={row.account.currentValueMinor} currency={row.account.currency} />
                      </td>
                      <td className="px-3 py-3">{row.directive && row.isIncluded ? <PrimaryCell row={row} /> : <span className="text-subtle">—</span>}</td>
                      <td className="px-3 py-3 text-right">{row.directive && row.isIncluded ? <TierFigure totalBps={row.contingentBps} /> : <span className="text-subtle">—</span>}</td>
                      <td className="px-3 py-3">
                        <AssetStatusBadge status={assetStatus(row, view.residuaryPrimaryBps)} />
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <Button variant={row.directive ? 'secondary' : 'primary'} aria-label={`${row.directive ? 'Edit' : 'Plan'} ${row.account.name}`} onClick={() => onSelect(row.account.id)}>
                          {row.directive ? 'Edit' : 'Plan'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line lg:hidden" aria-label="Assets">
              {view.assets.map((row) => (
                <li key={row.account.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-ink">{row.account.name}</p>
                      <p className="text-sm text-muted">
                        <Money minor={row.account.currentValueMinor} currency={row.account.currency} />
                        {row.directive ? (
                          <>
                            {' · '}
                            <Bps value={row.directive.ownershipShareBps} /> share
                          </>
                        ) : null}
                      </p>
                    </div>
                    <AssetStatusBadge status={assetStatus(row, view.residuaryPrimaryBps)} />
                  </div>
                  {row.directive && row.isIncluded ? (
                    <div className="mt-2.5 grid grid-cols-2 gap-3">
                      <div>
                        <p className="mb-1 text-xs text-muted">Primary</p>
                        <TierMeter totalBps={row.primaryBps} label={`${row.account.name} primary allocated`} />
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-muted">Contingent</p>
                        <TierMeter totalBps={row.contingentBps} label={`${row.account.name} contingent allocated`} />
                      </div>
                    </div>
                  ) : null}
                  <Button className="mt-3 w-full" variant={row.directive ? 'secondary' : 'primary'} aria-label={`${row.directive ? 'Edit directive and shares for' : 'Plan'} ${row.account.name}`} onClick={() => onSelect(row.account.id)}>
                    {row.directive ? 'Edit directive and shares' : 'Plan this asset'}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function PrimaryCell({ row }: { row: AssetRow }) {
  return (
    <div className="flex items-center gap-2">
      <TierMeter totalBps={row.primaryBps} label={`${row.account.name} primary allocated`} compact className="w-16" />
      <TierFigure totalBps={row.primaryBps} />
    </div>
  )
}

function ResidueCard({ view }: { view: EstateView }) {
  const upsert = async (input: EstateAllocationInput) => {
    await ensurePlan(view.workspace)
    return api.estate.upsertResiduary(input)
  }
  return (
    <Card aria-labelledby="estate-residue">
      <CardHeader
        id="estate-residue"
        title={
          <span className="inline-flex items-center gap-2">
            <Scale size={17} aria-hidden className="text-muted" />
            Residual estate
          </span>
        }
        description="Covers unallocated portions of listed assets and any property not listed. Specific shares above take precedence."
      />
      <CardBody>
        <div className="grid gap-8 lg:grid-cols-2">
          <TierEditor
            tier="primary"
            title="Primary residue"
            description="If an asset is 70% assigned, these shares divide the other 30%."
            rows={view.residuary.filter((r) => r.tier === 'primary')}
            beneficiaryById={view.beneficiaryById}
            activeBeneficiaries={view.activeBeneficiaries}
            subject="the residual estate"
            upsert={upsert}
            remove={(id) => api.estate.removeResiduary(id)}
          />
          <TierEditor
            tier="contingent"
            title="Contingent residue"
            description="Alternatives if a primary residual beneficiary can't inherit."
            rows={view.residuary.filter((r) => r.tier === 'contingent')}
            beneficiaryById={view.beneficiaryById}
            activeBeneficiaries={view.activeBeneficiaries}
            subject="the residual estate"
            upsert={upsert}
            remove={(id) => api.estate.removeResiduary(id)}
          />
        </div>
      </CardBody>
    </Card>
  )
}

function LiabilitiesCard({ view }: { view: EstateView }) {
  return (
    <Card aria-labelledby="estate-liabilities">
      <CardHeader id="estate-liabilities" title="Liabilities" description="Recorded liabilities are reviewed separately. They reduce what the estate can distribute but can't be assigned as gifts." />
      <CardBody>
        {view.liabilities.length ? (
          <ul className="divide-y divide-line" aria-label="Recorded liabilities">
            {view.liabilities.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{l.name}</p>
                  <p className="truncate text-xs text-muted">{l.categoryName}</p>
                </div>
                <Money minor={l.currentValueMinor} currency={l.currency} className="text-sm" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No active liabilities are recorded.</p>
        )}
        <p className="mt-3 text-xs text-subtle">Actual debts, taxes, secured claims, administration costs, and liquidity needs may change what each beneficiary receives.</p>
      </CardBody>
    </Card>
  )
}
