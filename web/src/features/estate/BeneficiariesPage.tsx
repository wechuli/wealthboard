import { Archive, Pencil, Plus, RotateCcw, Users } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { api } from '@/api'
import type { Beneficiary } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { BeneficiarySheet } from './BeneficiarySheet'
import { EstateSkeleton, ProblemNotice, useEstateView } from './kit'
import { BENEFICIARY_KINDS, beneficiaryRoles, labelOf, type BeneficiaryRole } from './model'

export default function BeneficiariesPage() {
  usePageTitle('Beneficiaries · Estate planning')
  const online = useOnline()
  const { view, isLoading, error, refetch } = useEstateView()
  const [sheet, setSheet] = useState<{ open: boolean; key: number; beneficiary: Beneficiary | null }>({ open: false, key: 0, beneficiary: null })
  const [archiving, setArchiving] = useState<Beneficiary | null>(null)
  const roles = useMemo(() => (view ? new Map(beneficiaryRoles(view).map((r) => [r.beneficiary.id, r])) : new Map<string, BeneficiaryRole>()), [view])

  const archive = useApiMutation({
    mutationFn: (b: Beneficiary) => api.estate.setBeneficiaryArchived(b.id, true),
    success: (_r, b) => `${b.name} archived`,
    toastError: false,
    onSuccess: () => setArchiving(null),
  })
  const restore = useApiMutation({ mutationFn: (b: Beneficiary) => api.estate.setBeneficiaryArchived(b.id, false), success: (_r, b) => `${b.name} restored` })

  const openSheet = (beneficiary: Beneficiary | null) => setSheet((s) => ({ open: true, key: s.key + 1, beneficiary }))

  if (error) return <ErrorState error={error} onRetry={refetch} title="Beneficiaries couldn't be loaded" />
  if (isLoading || !view) return <EstateSkeleton />

  const active = view.beneficiaries.filter((b) => !b.archivedAt)
  const archived = view.beneficiaries.filter((b) => !!b.archivedAt)
  const addButton = (
    <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => openSheet(null)} disabled={!online} title={!online ? OFFLINE_REASON : undefined}>
      Add beneficiary
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Beneficiaries"
          description="People, organizations, and trusts your plan provides for. They are private records: they never become users, account owners, or viewers."
          action={active.length ? addButton : undefined}
        />
        <CardBody>
          {active.length === 0 ? (
            <EmptyState compact icon={<Users size={20} aria-hidden />} title={archived.length ? 'No active beneficiaries' : 'Who should your plan provide for?'} action={addButton}>
              Add each person, organization, or trust once. You can then give them exact shares of specific assets or of everything not listed.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line" aria-label="Active beneficiaries">
              {active.map((b) => (
                <BeneficiaryRow key={b.id} beneficiary={b} role={roles.get(b.id)}>
                  <IconButton label={`Edit ${b.name}`} icon={<Pencil size={16} aria-hidden />} onClick={() => openSheet(b)} />
                  <IconButton label={`Archive ${b.name}`} icon={<Archive size={16} aria-hidden />} disabled={!online} onClick={() => setArchiving(b)} />
                </BeneficiaryRow>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {archived.length ? (
        <Card>
          <CardHeader level={2} title="Archived" description="Existing allocations that name an archived beneficiary stay in place and are flagged for review. Archived beneficiaries can't receive new shares." />
          <CardBody>
            <ProblemNotice error={restore.error} />
            <ul className="divide-y divide-line" aria-label="Archived beneficiaries">
              {archived.map((b) => (
                <BeneficiaryRow key={b.id} beneficiary={b} role={roles.get(b.id)} archived>
                  <Button variant="secondary" aria-label={`Restore ${b.name}`} icon={<RotateCcw size={15} aria-hidden />} disabled={!online || restore.isPending} onClick={() => restore.mutate(b)}>
                    Restore
                  </Button>
                </BeneficiaryRow>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <BeneficiarySheet key={sheet.key} open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} beneficiary={sheet.beneficiary} />

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(open) => {
          if (!open) {
            setArchiving(null)
            archive.reset()
          }
        }}
        title={archiving ? `Archive ${archiving.name}?` : 'Archive beneficiary?'}
        description="Their existing allocations stay in the plan and will be flagged for review. You can restore them later."
        confirmLabel="Archive beneficiary"
        pending={archive.isPending}
        onConfirm={() => archiving && archive.mutate(archiving)}
      >
        <ProblemNotice error={archive.error} />
      </ConfirmDialog>
    </div>
  )
}

function usageText(role: BeneficiaryRole | undefined): string {
  if (!role) return 'Not named in the plan yet'
  const parts: string[] = []
  if (role.primary.length) parts.push(`primary on ${role.primary.length} asset${role.primary.length === 1 ? '' : 's'}`)
  if (role.contingent.length) parts.push(`contingent on ${role.contingent.length}`)
  if (role.residuaryPrimaryBps || role.residuaryContingentBps) parts.push('named in the residue')
  if (!parts.length) return 'Not named in the plan yet'
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function BeneficiaryRow({ beneficiary: b, role, archived, children }: { beneficiary: Beneficiary; role: BeneficiaryRole | undefined; archived?: boolean; children: ReactNode }) {
  const meta = [b.relationship, b.contactSummary].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3.5">
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-base font-medium text-ink">{b.name}</p>
          <Badge>{labelOf(BENEFICIARY_KINDS, b.kind)}</Badge>
          {archived ? <Badge tone="warning">Archived</Badge> : null}
        </div>
        {meta ? <p className="mt-0.5 break-words text-sm text-muted">{meta}</p> : null}
        <p className="mt-0.5 text-xs text-subtle">{usageText(role)}</p>
        {b.notes ? <p className="mt-1 line-clamp-2 break-words text-sm text-muted">{b.notes}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </li>
  )
}
