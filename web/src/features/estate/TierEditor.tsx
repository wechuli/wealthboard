import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Trash2 } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import type { Beneficiary, EstateAllocationInput } from '@/api/types'
import { Bps } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { FieldShell, inputClass, SelectField, TextField } from '@/components/ui/Field'
import { cn } from '@/lib/cn'
import { formatBps } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation } from '@/lib/queries'
import { ProblemNotice, TierMeter } from './kit'
import { bpsToInput, FULL_BPS, parsePercent, projectedTierTotal, TIER_LABEL, type Tier } from './model'

export interface TierRow {
  id: string
  beneficiaryId: string
  tier: Tier
  allocationBps: number
  notes: string | null
}

interface TierEditorProps {
  tier: Tier
  title: string
  description: string
  /** Allocations in this tier only. */
  rows: TierRow[]
  beneficiaryById: Map<string, Beneficiary>
  activeBeneficiaries: Beneficiary[]
  /** "Southern Bypass Land" or "the residual estate": used in labels and confirmations. */
  subject: string
  upsert(input: EstateAllocationInput): Promise<unknown>
  remove(id: string): Promise<unknown>
}

/** One allocation tier: who is named, the live 100% check, and an add/update form. */
export function TierEditor({ tier, title, description, rows, beneficiaryById, activeBeneficiaries, subject, upsert, remove }: TierEditorProps) {
  const headingId = useId()
  const online = useOnline()
  const total = rows.reduce((sum, r) => sum + r.allocationBps, 0)
  const [editing, setEditing] = useState<{ key: number; row: TierRow | null }>({ key: 0, row: null })
  const [removing, setRemoving] = useState<TierRow | null>(null)
  const nameOf = (id: string) => beneficiaryById.get(id)?.name ?? 'Unknown beneficiary'

  const removal = useApiMutation({
    mutationFn: (row: TierRow) => remove(row.id),
    success: (_r, row) => `${nameOf(row.beneficiaryId)} removed from ${subject}`,
    toastError: false,
    onSuccess: () => setRemoving(null),
  })

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div>
        <h3 id={headingId} className="text-base font-semibold text-ink">
          {title}
        </h3>
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>
      <TierMeter totalBps={total} label={`${title} allocated`} />
      {rows.length ? (
        <ul className="divide-y divide-line rounded-md border border-line" aria-label={`${title} allocations`}>
          {rows.map((row) => {
            const b = beneficiaryById.get(row.beneficiaryId)
            return (
              <li key={row.id} className="flex items-center gap-2 py-1.5 pl-3 pr-1">
                <div className="min-w-0 flex-1 py-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-ink">{nameOf(row.beneficiaryId)}</span>
                    {b?.archivedAt ? <Badge tone="warning">Archived</Badge> : null}
                  </div>
                  {row.notes ? <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted">{row.notes}</p> : null}
                </div>
                <Bps value={row.allocationBps} className="shrink-0 text-sm font-semibold text-ink" />
                <div className="flex shrink-0 items-center">
                  {b && !b.archivedAt ? (
                    <IconButton label={`Edit ${nameOf(row.beneficiaryId)}'s ${tier} share`} icon={<Pencil size={15} aria-hidden />} onClick={() => setEditing((e) => ({ key: e.key + 1, row }))} />
                  ) : null}
                  <IconButton label={`Remove ${nameOf(row.beneficiaryId)}'s ${tier} share`} icon={<Trash2 size={15} aria-hidden />} disabled={!online} onClick={() => setRemoving(row)} />
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {activeBeneficiaries.length ? (
        <AllocationForm
          key={editing.key}
          tier={tier}
          tierTitle={title}
          rows={rows}
          editing={editing.row}
          activeBeneficiaries={activeBeneficiaries}
          beneficiaryById={beneficiaryById}
          subject={subject}
          upsert={upsert}
          onDone={() => setEditing((e) => ({ key: e.key + 1, row: null }))}
        />
      ) : (
        <p className="text-sm text-muted">
          <Link to="/estate/beneficiaries" className="link">
            Add a beneficiary
          </Link>{' '}
          before assigning shares.
        </p>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null)
            removal.reset()
          }
        }}
        title={removing ? `Remove ${nameOf(removing.beneficiaryId)}?` : 'Remove share?'}
        description={removing ? `Their ${formatBps(removing.allocationBps)} ${tier} share of ${subject} will be removed. Other shares stay as they are.` : undefined}
        confirmLabel="Remove share"
        pending={removal.isPending}
        onConfirm={() => removing && removal.mutate(removing)}
      >
        <ProblemNotice error={removal.error} />
      </ConfirmDialog>
    </section>
  )
}

interface AllocationFormProps {
  tier: Tier
  tierTitle: string
  rows: TierRow[]
  editing: TierRow | null
  activeBeneficiaries: Beneficiary[]
  beneficiaryById: Map<string, Beneficiary>
  subject: string
  upsert(input: EstateAllocationInput): Promise<unknown>
  onDone(): void
}

function AllocationForm({ tier, tierTitle, rows, editing, activeBeneficiaries, beneficiaryById, subject, upsert, onDone }: AllocationFormProps) {
  const id = useId()
  const online = useOnline()
  const schema = useMemo(
    () =>
      z
        .object({
          beneficiaryId: z.string().min(1, 'Choose a beneficiary'),
          percent: z.string(),
          notes: z.string().trim().max(2000, 'Use 2,000 characters or fewer'),
        })
        .superRefine((v, ctx) => {
          const parsed = parsePercent(v.percent, { label: 'share' })
          if (!parsed.ok) {
            ctx.addIssue({ code: 'custom', path: ['percent'], message: parsed.message })
            return
          }
          if (v.beneficiaryId && projectedTierTotal(rows, tier, v.beneficiaryId, parsed.bps) > FULL_BPS)
            ctx.addIssue({ code: 'custom', path: ['percent'], message: `The ${tier} tier can't total more than 100%` })
        }),
    [rows, tier],
  )
  type Values = z.infer<typeof schema>
  const { register, handleSubmit, formState, control, setValue, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { beneficiaryId: editing?.beneficiaryId ?? '', percent: editing ? bpsToInput(editing.allocationBps) : '', notes: editing?.notes ?? '' },
  })
  const save = useApiMutation({
    mutationFn: (input: EstateAllocationInput) => upsert(input),
    success: (_r, input) => `${beneficiaryById.get(input.beneficiaryId)?.name ?? 'Share'} · ${formatBps(input.allocationBps)} ${tier} share of ${subject} saved`,
    toastError: false,
    onSuccess: () => {
      reset({ beneficiaryId: '', percent: '', notes: '' })
      onDone()
    },
  })

  const beneficiaryId = useWatch({ control, name: 'beneficiaryId' })
  const percent = useWatch({ control, name: 'percent' })
  const existing = rows.find((r) => r.beneficiaryId === beneficiaryId) ?? null
  const othersBps = rows.reduce((sum, r) => (r.beneficiaryId === beneficiaryId ? sum : sum + r.allocationBps), 0)
  const maxBps = Math.max(0, FULL_BPS - othersBps)
  const parsed = percent.trim() ? parsePercent(percent, { label: 'share' }) : null
  const projected = parsed?.ok ? othersBps + parsed.bps : null
  const over = projected !== null && projected > FULL_BPS

  const onSubmit = handleSubmit((v) => {
    const p = parsePercent(v.percent, { label: 'share' })
    if (!p.ok || save.isPending) return
    save.mutate({ beneficiaryId: v.beneficiaryId, tier, allocationBps: p.bps, notes: v.notes || undefined })
  })

  const options = activeBeneficiaries.map((b) => ({ value: b.id, label: b.name }))
  const overText = over ? `Over by ${formatBps((projected ?? 0) - FULL_BPS)}. ${maxBps > 0 ? `Enter ${formatBps(maxBps)} or less.` : 'This tier is already at 100%; lower another share first.'}` : null
  const percentError = overText ?? formState.errors.percent?.message

  return (
    <form onSubmit={onSubmit} noValidate aria-label={`${editing ? 'Update' : 'Add'} ${tier} share`} className="flex flex-col gap-4 rounded-md bg-sunken/60 p-3.5">
      <ProblemNotice error={save.error} title="The share was not saved" />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <SelectField label={`${TIER_LABEL[tier]} beneficiary`} placeholder="Choose a beneficiary" options={options} error={formState.errors.beneficiaryId?.message} {...register('beneficiaryId')} />
        <FieldShell label="Share" error={percentError}>
          {({ id: inputId, describedBy, invalid }) => (
            <div className="relative">
              <input
                id={inputId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="50"
                aria-describedby={[describedBy, `${id}-projection`].filter(Boolean).join(' ')}
                aria-invalid={invalid}
                className={cn(inputClass, 'num pr-9 text-right')}
                {...register('percent')}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-subtle">%</span>
            </div>
          )}
        </FieldShell>
      </div>
      <TextField label="Note" optional maxLength={2000} placeholder="A condition or instruction to discuss with an adviser" error={formState.errors.notes?.message} {...register('notes')} />
      <p id={`${id}-projection`} aria-live="polite" className={cn('num text-xs', over ? 'font-medium text-negative' : projected === FULL_BPS ? 'text-positive' : 'text-muted')}>
        {projectionText({ tierTitle, existing, projected, maxBps })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!online || over}>
          {existing ? 'Update share' : 'Add share'}
        </Button>
        {maxBps > 0 && beneficiaryId && (!parsed?.ok || parsed.bps !== maxBps) ? (
          <Button variant="ghost" onClick={() => setValue('percent', bpsToInput(maxBps), { shouldValidate: true })}>
            Use remaining {formatBps(maxBps)}
          </Button>
        ) : null}
        {editing ? (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
        {!online ? <p className="text-xs text-warning">{OFFLINE_REASON}</p> : null}
      </div>
    </form>
  )
}

function projectionText({ tierTitle, existing, projected, maxBps }: { tierTitle: string; existing: TierRow | null; projected: number | null; maxBps: number }): string {
  const replaces = existing ? `Replaces their current ${formatBps(existing.allocationBps)}. ` : ''
  if (projected === null) return `${replaces}Up to ${formatBps(maxBps)} is available in the ${tierTitle.toLowerCase()} tier.`
  if (projected > FULL_BPS) return `${replaces}${tierTitle} would total ${formatBps(projected)}, ${formatBps(projected - FULL_BPS)} over 100%.`
  if (projected === FULL_BPS) return `${replaces}${tierTitle} will total exactly 100%.`
  return `${replaces}${tierTitle} will total ${formatBps(projected)}, leaving ${formatBps(FULL_BPS - projected)}.`
}
