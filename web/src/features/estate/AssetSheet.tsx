import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Info } from 'lucide-react'
import { useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { EstateDirectiveInput } from '@/api/types'
import { Money, Unavailable } from '@/components/format'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Dialog'
import { DateField, FieldShell, inputClass, SelectField, SwitchField, TextareaField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation } from '@/lib/queries'
import { AssetStatusBadge, ensurePlan, fieldError, ProblemNotice } from './kit'
import { assetStatus, bpsToInput, calendarDate, DISTRIBUTION_METHODS, parsePercent, reviewItems, TRANSFER_CONTEXTS, type AssetRow, type EstateView } from './model'
import { TierEditor } from './TierEditor'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  isIncluded: z.boolean(),
  ownership: z.string().superRefine((v, ctx) => {
    const p = parsePercent(v, { label: 'ownership share' })
    if (!p.ok) ctx.addIssue({ code: 'custom', message: p.message })
  }),
  transferContext: z.enum(['estate', 'joint_survivorship', 'provider_designation', 'trust_entity', 'unknown']),
  distributionMethod: z.enum(['transfer_asset', 'sell_and_divide', 'cash_equivalent', 'undecided']),
  documentReference: z.string().trim().max(300, 'Use 300 characters or fewer'),
  notes: z.string().trim().max(2000, 'Use 2,000 characters or fewer'),
  reviewedAt: z.string().refine((v) => v === '' || DATE.test(v), 'Enter a valid date'),
})
type Values = z.infer<typeof schema>

/** Everything about one asset's place in the plan: directive, then primary and contingent shares. */
export function AssetSheet({ view, row, open, onOpenChange }: { view: EstateView; row: AssetRow; open: boolean; onOpenChange(open: boolean): void }) {
  const { baseCurrency, today } = usePrefs()
  const { account, directive } = row
  const items = reviewItems(view, today).filter((i) => i.accountId === account.id)
  const status = assetStatus(row, view.residuaryPrimaryBps)
  const meta = [account.categoryName, account.institutionName, account.currency].filter(Boolean).join(' · ')

  return (
    <Sheet open={open} onOpenChange={onOpenChange} width="lg" title={account.name} description={meta}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
          <div className="min-w-0">
            <p className="text-sm text-muted">Recorded account value</p>
            <p className="mt-0.5 text-lg font-semibold text-ink">
              <Money minor={account.currentValueMinor} currency={account.currency} />
            </p>
            {account.currency !== baseCurrency ? (
              <p className="mt-0.5 text-sm text-muted">
                {account.convertedValueMinor === null ? (
                  <Unavailable label="No exchange rate" reason={`Add a ${account.currency}/${baseCurrency} rate in Settings to see this in ${baseCurrency}.`} />
                ) : (
                  <>
                    ≈ <Money minor={account.convertedValueMinor} currency={baseCurrency} />
                  </>
                )}
              </p>
            ) : null}
            <p className="mt-1.5 max-w-[52ch] text-xs text-subtle">Indicative only. This is the account's current cached value, not an estate valuation, and it is not split by share.</p>
          </div>
          <AssetStatusBadge status={status} />
        </div>

        {items.length ? (
          <ul className="flex flex-col gap-2" aria-label="Review items for this asset">
            {items.map((item) => (
              <li key={item.code} className={cn('flex items-start gap-2 rounded-md px-3 py-2 text-sm', item.severity === 'blocking' ? 'bg-warning-soft text-ink' : 'bg-sunken text-ink')}>
                {item.severity === 'blocking' ? <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" /> : <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-muted" />}
                <span>
                  <span className="sr-only">{item.severity === 'blocking' ? 'Needs a decision: ' : 'To review: '}</span>
                  {item.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <DirectiveForm key={directive?.updatedAt ?? 'new'} view={view} row={row} />

        {directive && row.isIncluded ? (
          <div className="flex flex-col gap-8 border-t border-line pt-6">
            <TierEditor
              tier="primary"
              title="Primary beneficiaries"
              description="The first intended recipients. Shares should total 100%, or a complete residue covers what's left."
              rows={row.allocations.filter((a) => a.tier === 'primary')}
              beneficiaryById={view.beneficiaryById}
              activeBeneficiaries={view.activeBeneficiaries}
              subject={account.name}
              upsert={(input) => api.estate.upsertAllocation(directive.id, input)}
              remove={(id) => api.estate.removeAllocation(id)}
            />
            <TierEditor
              tier="contingent"
              title="Contingent beneficiaries"
              description="Alternatives if a primary recipient can't inherit. When used, they must total 100%."
              rows={row.allocations.filter((a) => a.tier === 'contingent')}
              beneficiaryById={view.beneficiaryById}
              activeBeneficiaries={view.activeBeneficiaries}
              subject={account.name}
              upsert={(input) => api.estate.upsertAllocation(directive.id, input)}
              remove={(id) => api.estate.removeAllocation(id)}
            />
          </div>
        ) : (
          <Notice tone="info" title={directive ? 'This asset is excluded from the plan' : 'Save the directive to name beneficiaries'}>
            {directive ? 'Include it above to assign primary and contingent beneficiaries.' : 'Once saved, you can give primary and contingent beneficiaries exact shares of this asset.'}
          </Notice>
        )}
      </div>
    </Sheet>
  )
}

function DirectiveForm({ view, row }: { view: EstateView; row: AssetRow }) {
  const formId = useId()
  const online = useOnline()
  const { account, directive } = row
  const { register, handleSubmit, formState, control } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      isIncluded: row.isIncluded,
      ownership: bpsToInput(directive?.ownershipShareBps ?? 10_000),
      transferContext: directive?.transferContext ?? 'unknown',
      distributionMethod: directive?.distributionMethod ?? 'undecided',
      documentReference: directive?.documentReference ?? '',
      notes: directive?.notes ?? '',
      reviewedAt: calendarDate(directive?.reviewedAt),
    },
  })
  const save = useApiMutation({
    mutationFn: async (body: EstateDirectiveInput) => {
      await ensurePlan(view.workspace)
      return api.estate.upsertDirective(account.id, body)
    },
    success: `Directive for ${account.name} saved`,
    toastError: false,
  })
  const onSubmit = handleSubmit((v) => {
    const share = parsePercent(v.ownership, { label: 'ownership share' })
    if (!share.ok || save.isPending) return
    save.mutate({
      isIncluded: v.isIncluded,
      ownershipShareBps: share.bps,
      transferContext: v.transferContext,
      distributionMethod: v.distributionMethod,
      documentReference: v.documentReference || undefined,
      notes: v.notes || undefined,
      reviewedAt: v.reviewedAt || null,
    })
  })
  const err = (name: keyof Values, apiName: string = name) => formState.errors[name]?.message ?? fieldError(save.error, apiName)

  return (
    <form id={formId} onSubmit={onSubmit} noValidate aria-label={`Directive for ${account.name}`} className="flex flex-col gap-5">
      <ProblemNotice error={save.error} title="The directive was not saved" />
      <Controller
        control={control}
        name="isIncluded"
        render={({ field }) => (
          <SwitchField
            label="Include this asset in the distribution plan"
            description="Turn off for items that are informational or deliberately outside the plan."
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <FieldShell label="Estate ownership share" hint="How much of this asset is yours to leave, for example 50% of a jointly owned plot." error={err('ownership', 'ownershipShareBps')}>
          {({ id, describedBy, invalid }) => (
            <div className="relative">
              <input id={id} type="text" inputMode="decimal" autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid} className={cn(inputClass, 'num pr-9 text-right')} {...register('ownership')} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-subtle">%</span>
            </div>
          )}
        </FieldShell>
        <DateField label="Last checked" optional error={err('reviewedAt')} {...register('reviewedAt')} />
        <SelectField label="How it passes" options={TRANSFER_CONTEXTS} error={err('transferContext')} {...register('transferContext')} />
        <SelectField label="Distribution method" options={DISTRIBUTION_METHODS} error={err('distributionMethod')} {...register('distributionMethod')} />
      </div>
      <TextField
        label="Document or location reference"
        optional
        maxLength={300}
        placeholder="For example, title deed in the home safe"
        hint="Excluded from printed summaries unless you include references."
        error={err('documentReference')}
        {...register('documentReference')}
      />
      <TextareaField label="Planning notes" optional maxLength={2000} error={err('notes')} {...register('notes')} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!online}>
          Save directive
        </Button>
        {!online ? <p className="text-xs text-warning">{OFFLINE_REASON}</p> : null}
      </div>
    </form>
  )
}
