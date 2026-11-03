import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Account } from '@/api/types'
import { AmountField, DateField, TextareaField, TextField } from '@/components/ui/Field'
import { Money, DateText } from '@/components/format'
import { decimalToMinor, formatMoney, PrecisionError } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { newIdempotencyKey, useApiMutation } from '@/lib/queries'
import { actionMeta, accountAllows } from '../actions'
import type { RecordAction } from '../recorder'
import { AccountSelect, applyFieldErrors, RecordingForm, useFocusFirstError } from '../shared'

/** Validates a positive amount in the account currency and checks minor-unit precision. */
export function amountRule(currency: () => string | undefined, opts: { allowZero?: boolean } = {}) {
  return z.string().superRefine((value, ctx) => {
    const ccy = currency()
    if (!value.trim()) return ctx.addIssue({ code: 'custom', message: 'Enter an amount' })
    if (!ccy) return
    try {
      const minor = decimalToMinor(value, ccy)
      if (BigInt(minor) < 0n || (!opts.allowZero && BigInt(minor) === 0n)) ctx.addIssue({ code: 'custom', message: opts.allowZero ? 'Enter zero or more' : 'Enter an amount greater than zero' })
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: e instanceof PrecisionError ? e.message : 'Enter a number' })
    }
  })
}

export function TransactionForm({ formId, action, accounts, initialAccountId, onDone, onPendingChange }: { formId: string; action: RecordAction; accounts: Account[]; initialAccountId?: string; onDone(accountId: string): void; onPendingChange(p: boolean): void }) {
  const meta = actionMeta(action)
  const { today } = usePrefs()
  const eligible = useMemo(() => accounts.filter((a) => accountAllows(a, action)), [accounts, action])
  const [accountId, setAccountId] = useState(() => (eligible.some((a) => a.id === initialAccountId) ? initialAccountId! : (eligible[0]?.id ?? '')))
  const account = eligible.find((a) => a.id === accountId)

  const schema = z.object({
    accountId: z.string().min(1, 'Choose an account'),
    amount: amountRule(() => account?.currency),
    date: z.string().min(1, 'Choose a date').refine((d) => d <= today, 'Choose today or an earlier date'),
    description: z.string().max(140, 'Keep it under 140 characters'),
    notes: z.string().max(1000),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { accountId, amount: '', date: today, description: '', notes: '' } })
  useFocusFirstError(form.formState.errors, form.formState.submitCount)

  const mutation = useApiMutation({
    mutationFn: (v: Values & { idempotencyKey: string }) =>
      api.transactions.create({
        idempotencyKey: v.idempotencyKey,
        accountId: v.accountId,
        type: meta.txnType!,
        amountMinor: decimalToMinor(v.amount, account!.currency),
        transactionDate: v.date,
        description: v.description.trim() || undefined,
        notes: v.notes.trim() || undefined,
      }),
    success: (_r, v) => `${meta.label} of ${formatMoney(decimalToMinor(v.amount, account!.currency), account!.currency)} recorded`,
    toastError: false,
    onSuccess: (_r, v) => onDone(v.accountId),
  })

  const submit = form.handleSubmit((v) => {
    if (mutation.isPending) return
    onPendingChange(true)
    mutation.mutate(
      { ...v, idempotencyKey: newIdempotencyKey() },
      {
        onError: (e) => applyFieldErrors(e, form.setError, { amountMinor: 'amount', transactionDate: 'date', accountId: 'accountId' }),
        onSettled: () => onPendingChange(false),
      },
    )
  })

  if (eligible.length === 0) return <NoEligibleAccounts action={action} />

  return (
    <RecordingForm id={formId} onSubmit={submit} error={mutation.error}>
      <AccountSelect
        accounts={eligible}
        value={accountId}
        name="accountId"
        error={form.formState.errors.accountId?.message}
        onChange={(id) => {
          setAccountId(id)
          form.setValue('accountId', id, { shouldValidate: form.formState.isSubmitted })
        }}
        hint={<ValueReference account={account} />}
      />
      <Controller
        control={form.control}
        name="amount"
        render={({ field, fieldState }) => (
          <AmountField label="Amount" currency={account?.currency ?? 'KES'} value={field.value} onChange={field.onChange} onBlur={field.onBlur} name={field.name} error={fieldState.error?.message} autoFocus />
        )}
      />
      <DateField label="Date" max={today} {...form.register('date')} error={form.formState.errors.date?.message} />
      <TextField label="Description" optional placeholder={meta.description} {...form.register('description')} error={form.formState.errors.description?.message} />
      <TextareaField label="Notes" optional rows={2} {...form.register('notes')} />
      {action === 'deposit' || action === 'withdrawal' ? (
        <p className="text-xs text-muted">
          {action === 'deposit' ? 'Deposits count as contributions.' : 'Withdrawals count against contributions.'} Moving money between your own accounts? Use a transfer instead.
        </p>
      ) : null}
    </RecordingForm>
  )
}

export function NoEligibleAccounts({ action }: { action: RecordAction }) {
  const copy: Partial<Record<RecordAction, string>> = {
    payment: 'Add a loan or other liability first, then record payments against it.',
    increase: 'Add a loan or other liability first.',
    valuation: 'Add a value-tracked account first (for example land, a vehicle, or a fund).',
    buy: 'Add a position-tracked investment account first.',
    sell: 'Add a position-tracked investment account first.',
    price: 'Add an instrument to a position-tracked account first.',
  }
  return <p className="rounded-md border border-dashed border-line bg-sunken/50 px-4 py-6 text-center text-sm text-muted">{copy[action] ?? 'Add an account first.'}</p>
}

export function ValueReference({ account }: { account: Account | undefined }) {
  if (!account) return null
  return (
    <>
      Currently <Money minor={account.currentValueMinor} currency={account.currency} />
      {account.openedAt ? (
        <>
          {' '}
          · tracked since <DateText value={account.openedAt} />
        </>
      ) : null}
    </>
  )
}
