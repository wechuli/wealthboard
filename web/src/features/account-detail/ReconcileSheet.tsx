/** Record a broker statement total for a position-tracked account. Observations never change source records. */
import { zodResolver } from '@hookform/resolvers/zod'
import { ClipboardCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Account, AccountPosition, PositionReconciliation } from '@/api/types'
import { DateText, Money } from '@/components/format'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { AmountField, DateField, TextareaField } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatDate } from '@/lib/dates'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useAccountAnalytics, useApiMutation, useReconciliations } from '@/lib/queries'
import { Consequences, FigureList, FormSection, WorkflowProblem, decimalMessage, isNonNegativeDecimal, moneyDecimal, optional } from './workflow-kit'

export function ReconcileSheet({ account, open, onOpenChange }: { account: Account; positions: AccountPosition[]; open: boolean; onOpenChange(o: boolean): void }) {
  const { today } = usePrefs()
  const online = useOnline()
  const analytics = useAccountAnalytics(account.id)
  const c = account.currency
  const schema = z.object({
    observationDate: z
      .string()
      .min(1, 'Choose the statement date')
      .refine((d) => d <= today, 'Choose today or an earlier date'),
    reportedTotal: z.string().min(1, 'Enter the total from the statement').refine(isNonNegativeDecimal, decimalMessage.nonNegative),
    reportedCash: z.string().refine((v) => v === '' || isNonNegativeDecimal(v), decimalMessage.nonNegative),
    notes: z.string().max(1000, 'Keep notes under 1,000 characters'),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { observationDate: today, reportedTotal: '', reportedCash: '', notes: '' } })

  const create = useApiMutation({
    mutationFn: (v: Values) =>
      api.reconciliations.create({
        accountId: account.id,
        observationDate: v.observationDate,
        reportedTotal: moneyDecimal(v.reportedTotal, c),
        reportedCash: v.reportedCash ? moneyDecimal(v.reportedCash, c) : undefined,
        notes: optional(v.notes),
      }),
    success: 'Statement reconciliation saved',
    toastError: false,
    onSuccess: (_r, v) => form.reset({ observationDate: v.observationDate, reportedTotal: '', reportedCash: '', notes: '' }),
  })
  const submit = form.handleSubmit((v) => create.mutate(v))
  const ps = analytics.data?.positionSummary

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reconcile to statement"
      description={`Compare ${account.name} with your broker's figures.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="submit" form="reconcile-account" variant="primary" loading={create.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
            Save reconciliation
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Consequences
          title="What a reconciliation does"
          items={[
            'It keeps the statement total next to the account as a dated observation.',
            'It never changes quantities, prices, cash, or the value Wealthboard calculates.',
            'If the figures disagree, find the missing trade, price, or fee and record that instead.',
          ]}
        />

        <section aria-labelledby="reconcile-now" className="space-y-2">
          <h3 id="reconcile-now" className="text-sm font-semibold text-ink">
            Wealthboard today
          </h3>
          {analytics.isPending ? (
            <Skeleton className="h-28" />
          ) : (
            <FigureList
              items={[
                ...(ps
                  ? [
                      { label: 'Cash', value: <Money minor={ps.cashMinor} currency={c} /> },
                      { label: 'Holdings', value: <Money minor={ps.positionsMinor} currency={c} />, hint: ps.complete ? undefined : 'Incomplete: a holding has no price or rate' },
                    ]
                  : []),
                { label: 'Total', strong: true, value: <Money minor={account.currentValueMinor} currency={c} /> },
              ]}
            />
          )}
          <p className="text-xs text-muted">For an earlier statement date, Wealthboard's value on that date may differ from today's.</p>
        </section>

        <form id="reconcile-account" onSubmit={submit} noValidate>
          <FormSection title="Statement figures">
            <DateField label="Statement date" max={today} {...form.register('observationDate')} error={form.formState.errors.observationDate?.message} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="reportedTotal"
                render={({ field, fieldState }) => (
                  <AmountField label="Reported total" currency={c} value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
                )}
              />
              <Controller
                control={form.control}
                name="reportedCash"
                render={({ field, fieldState }) => (
                  <AmountField label="Reported cash" optional currency={c} value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
                )}
              />
            </div>
            <TextareaField label="Notes" optional rows={2} {...form.register('notes')} error={form.formState.errors.notes?.message} placeholder="Statement reference or anything that explains a gap" />
          </FormSection>
          <WorkflowProblem error={create.error} className="mt-4" />
        </form>

        <ReconciliationList account={account} />
      </div>
    </Sheet>
  )
}

function ReconciliationList({ account }: { account: Account }) {
  const q = useReconciliations(account.id)
  const online = useOnline()
  const { dateFormat, timezone } = usePrefs()
  const [target, setTarget] = useState<PositionReconciliation | null>(null)
  const remove = useApiMutation({
    mutationFn: (id: string) => api.reconciliations.remove(id),
    success: 'Reconciliation removed',
    toastError: false,
    onSuccess: () => setTarget(null),
  })
  const items = q.data?.items ?? []
  return (
    <section aria-labelledby="reconcile-history" className="space-y-2">
      <h3 id="reconcile-history" className="text-sm font-semibold text-ink">
        Earlier reconciliations
      </h3>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-line-strong/60 px-3 py-3 text-sm text-muted">
          <ClipboardCheck size={16} aria-hidden className="shrink-0" />
          None yet. Saved statement totals appear here with their dates.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  <DateText value={r.observationDate} />
                </p>
                <p className="truncate text-xs text-muted">
                  {r.reportedCashMinor ? (
                    <>
                      Cash <Money minor={r.reportedCashMinor} currency={account.currency} />
                      {r.notes ? ' · ' : ''}
                    </>
                  ) : null}
                  {r.notes ?? (r.reportedCashMinor ? '' : 'Statement total')}
                </p>
              </div>
              <Money minor={r.reportedTotalMinor} currency={account.currency} className="shrink-0 text-sm font-medium" />
              <IconButton label={`Delete reconciliation of ${formatDate(r.observationDate, dateFormat, timezone)}`} icon={<Trash2 size={16} />} onClick={() => setTarget(r)} disabled={!online} />
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null)
            remove.reset()
          }
        }}
        title="Delete this reconciliation?"
        description="Only the saved statement figures are removed. Holdings, cash, and values don't change."
        confirmLabel="Delete reconciliation"
        pending={remove.isPending}
        confirmDisabled={!online}
        onConfirm={() => target && remove.mutate(target.id)}
      >
        {target ? (
          <p className="text-sm text-muted">
            Statement of <DateText value={target.observationDate} /> reporting <Money minor={target.reportedTotalMinor} currency={account.currency} />.
          </p>
        ) : null}
        <WorkflowProblem error={remove.error} className="mt-3" />
      </ConfirmDialog>
    </section>
  )
}
