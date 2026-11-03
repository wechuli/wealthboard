import { useState, type FormEvent } from 'react'
import { api } from '@/api'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { ActivityItem, MutableTransactionType } from '@/api/types'
import { Money } from '@/components/format'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Dialog'
import { AmountField, DateField, SelectField, TextareaField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { absMinor, decimalToMinor, minorSign, minorToDecimal, PrecisionError } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { newIdempotencyKey, useApiMutation } from '@/lib/queries'
import { activityEffect } from '@/lib/activity'
import { ActivityIcon, isMutableType, MUTABLE_TYPES, typeLabel } from './activityMeta'

interface FormState {
  type: MutableTransactionType
  amount: string
  date: string
  description: string
  notes: string
}

/** The editable amount: the absolute value of the signed effect (string manipulation, not arithmetic). */
function initialAmount(item: ActivityItem): string {
  const minor = item.type === 'manual_adjustment' ? item.amountMinor : absMinor(item.amountMinor)
  return minorToDecimal(minor, item.currency)
}

/** Edit a cash transaction (deposits, withdrawals, interest, fees, and similar). Transfers are not editable here. */
export function EditTransactionSheet({ item, open, onOpenChange }: { item: ActivityItem; open: boolean; onOpenChange(open: boolean): void }) {
  const online = useOnline()
  const { today } = usePrefs()
  const [form, setForm] = useState<FormState>(() => ({
    type: isMutableType(item.type) ? item.type : 'deposit',
    amount: initialAmount(item),
    date: item.date,
    description: item.description ?? '',
    notes: item.notes ?? '',
  }))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useApiMutation({
    mutationFn: (body: Parameters<typeof api.transactions.update>[1]) => api.transactions.update(item.id, body),
    success: 'Transaction updated',
    toastError: false,
    onSuccess: () => onOpenChange(false),
  })

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const signed = form.type === 'manual_adjustment'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const next: typeof errors = {}
    let amountMinor = ''
    try {
      amountMinor = decimalToMinor(form.amount, item.currency)
      if (signed ? minorSign(amountMinor) === 0 : minorSign(amountMinor) <= 0) next.amount = signed ? 'Enter a non-zero amount' : 'Enter an amount greater than zero'
    } catch (err) {
      next.amount = err instanceof PrecisionError ? err.message : 'Enter an amount'
    }
    if (!form.date) next.date = 'Choose a date'
    else if (form.date > today) next.date = 'Choose today or earlier'
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    mutation.mutate(
      {
        idempotencyKey: newIdempotencyKey(),
        type: form.type,
        amountMinor,
        transactionDate: form.date,
        description: form.description.trim() || undefined,
        notes: form.notes.trim() || undefined,
      },
      {
        onError: (err) => {
          const fe = ApiProblem.is(err) ? err.fieldErrors : undefined
          if (fe) {
            setErrors({
              type: fe.type,
              amount: fe.amountMinor,
              date: fe.transactionDate,
              description: fe.description,
              notes: fe.notes,
            })
          }
          setFormError(problemMessage(err))
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit transaction"
      description={
        <>
          {item.accountName} · {item.currency}
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`edit-txn-${item.id}`} loading={mutation.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
            Save changes
          </Button>
        </>
      }
    >
      <form id={`edit-txn-${item.id}`} onSubmit={submit} className="grid gap-5" noValidate>
        <div className="flex items-center gap-3 rounded-md border border-line bg-sunken/60 px-3.5 py-3">
          <ActivityIcon type={item.type} />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-ink">Currently recorded</p>
            <p className="text-muted">
              {typeLabel(item.type)} of <Money minor={activityEffect(item)} currency={item.currency} sign="always" />
            </p>
          </div>
        </div>

        {!online ? (
          <Notice tone="warning" title="You're offline">
            {OFFLINE_REASON}
          </Notice>
        ) : null}
        {formError ? (
          <Notice tone="negative" title="The change wasn't saved" role="alert">
            {formError}
          </Notice>
        ) : null}

        <SelectField
          label="Type"
          value={form.type}
          onChange={(e) => set('type', e.target.value as MutableTransactionType)}
          options={MUTABLE_TYPES.map((t) => ({
            value: t,
            label: typeLabel(t),
          }))}
          error={errors.type}
          hint="The type decides whether the amount adds to or reduces the account."
        />
        <AmountField
          label="Amount"
          currency={item.currency}
          value={form.amount}
          onChange={(v) => set('amount', v)}
          allowNegative={signed}
          error={errors.amount}
          hint={signed ? 'Adjustments keep their sign: negative reduces the balance.' : 'Enter the amount without a sign.'}
        />
        <DateField label="Date" value={form.date} max={today} onChange={(e) => set('date', e.target.value)} error={errors.date} required />
        <TextField label="Description" optional value={form.description} onChange={(e) => set('description', e.target.value)} error={errors.description} maxLength={200} />
        <TextareaField label="Notes" optional value={form.notes} onChange={(e) => set('notes', e.target.value)} error={errors.notes} maxLength={2000} />
        <p className="text-xs text-muted">Saving recalculates the account's value history, your net worth, and any goal linked to this account.</p>
      </form>
    </Sheet>
  )
}
