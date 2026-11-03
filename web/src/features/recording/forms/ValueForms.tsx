import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Account } from '@/api/types'
import { AmountField, DateField, TextareaField } from '@/components/ui/Field'
import { decimalToMinor, formatMoney } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { newIdempotencyKey, useApiMutation } from '@/lib/queries'
import { accountAllows } from '../actions'
import { AccountSelect, applyFieldErrors, RecordingForm, useFocusFirstError } from '../shared'
import { amountRule, NoEligibleAccounts, ValueReference } from './TransactionForm'

/** Valuation: sets an absolute value. Never a contribution. */
export function ValuationForm({ formId, accounts, initialAccountId, onDone, onPendingChange }: { formId: string; accounts: Account[]; initialAccountId?: string; onDone(accountId: string): void; onPendingChange(p: boolean): void }) {
  const { today } = usePrefs()
  const eligible = useMemo(() => accounts.filter((a) => accountAllows(a, 'valuation')), [accounts])
  const [accountId, setAccountId] = useState(() => (eligible.some((a) => a.id === initialAccountId) ? initialAccountId! : (eligible[0]?.id ?? '')))
  const account = eligible.find((a) => a.id === accountId)
  const schema = z.object({
    accountId: z.string().min(1, 'Choose an account'),
    value: amountRule(() => account?.currency, { allowZero: true }),
    date: z.string().min(1, 'Choose a date').refine((d) => d <= today, 'Choose today or an earlier date'),
    notes: z.string().max(1000),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { accountId, value: '', date: today, notes: '' } })
  useFocusFirstError(form.formState.errors, form.formState.submitCount)
  const mutation = useApiMutation({
    mutationFn: (v: Values & { idempotencyKey: string }) =>
      api.valuations.create({ idempotencyKey: v.idempotencyKey, accountId: v.accountId, valueMinor: decimalToMinor(v.value, account!.currency), valuationDate: v.date, notes: v.notes.trim() || undefined }),
    success: (_r, v) => `${account!.name} valued at ${formatMoney(decimalToMinor(v.value, account!.currency), account!.currency)}`,
    toastError: false,
    onSuccess: (_r, v) => onDone(v.accountId),
  })
  const submit = form.handleSubmit((v) => {
    if (mutation.isPending) return
    onPendingChange(true)
    mutation.mutate({ ...v, idempotencyKey: newIdempotencyKey() }, { onError: (e) => applyFieldErrors(e, form.setError, { valueMinor: 'value', valuationDate: 'date' }), onSettled: () => onPendingChange(false) })
  })
  if (eligible.length === 0) return <NoEligibleAccounts action="valuation" />
  return (
    <RecordingForm id={formId} onSubmit={submit} error={mutation.error}>
      <AccountSelect
        accounts={eligible}
        value={accountId}
        error={form.formState.errors.accountId?.message}
        onChange={(id) => {
          setAccountId(id)
          form.setValue('accountId', id)
        }}
        hint={<ValueReference account={account} />}
      />
      <Controller
        control={form.control}
        name="value"
        render={({ field, fieldState }) => (
          <AmountField label={account?.isLiability ? 'Amount owed' : 'Value today'} currency={account?.currency ?? 'KES'} value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} autoFocus />
        )}
      />
      <DateField label="Valuation date" max={today} {...form.register('date')} error={form.formState.errors.date?.message} />
      <TextareaField label="Source or notes" optional rows={2} placeholder="For example: registered valuer report, dealer quote" {...form.register('notes')} />
      <p className="text-xs text-muted">A valuation sets the value outright. It changes growth, never contributions.</p>
    </RecordingForm>
  )
}

/** Transfer between two of the user's accounts (a paired transfer, not a contribution). */
export function TransferForm({ formId, accounts, initialAccountId, onDone, onPendingChange }: { formId: string; accounts: Account[]; initialAccountId?: string; onDone(accountId: string): void; onPendingChange(p: boolean): void }) {
  const { today } = usePrefs()
  const eligible = useMemo(() => accounts.filter((a) => accountAllows(a, 'transfer')), [accounts])
  const [fromId, setFromId] = useState(() => (eligible.some((a) => a.id === initialAccountId) ? initialAccountId! : (eligible[0]?.id ?? '')))
  const [toId, setToId] = useState(() => eligible.find((a) => a.id !== fromId)?.id ?? '')
  const from = eligible.find((a) => a.id === fromId)
  const to = eligible.find((a) => a.id === toId)
  const crossCurrency = !!from && !!to && from.currency !== to.currency
  const schema = z
    .object({
      fromId: z.string().min(1, 'Choose an account'),
      toId: z.string().min(1, 'Choose an account'),
      amount: amountRule(() => from?.currency),
      received: z.string(),
      date: z.string().min(1, 'Choose a date').refine((d) => d <= today, 'Choose today or an earlier date'),
      description: z.string().max(140),
    })
    .refine((v) => v.fromId !== v.toId, { path: ['toId'], message: 'Choose a different account' })
    .superRefine((v, ctx) => {
      if (!crossCurrency) return
      try {
        if (!v.received || BigInt(decimalToMinor(v.received, to!.currency)) <= 0n) ctx.addIssue({ code: 'custom', path: ['received'], message: `Enter the amount received in ${to!.currency}` })
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: ['received'], message: e instanceof Error ? e.message : 'Enter a number' })
      }
    })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { fromId, toId, amount: '', received: '', date: today, description: '' } })
  useFocusFirstError(form.formState.errors, form.formState.submitCount)
  const mutation = useApiMutation({
    mutationFn: (v: Values & { idempotencyKey: string }) =>
      api.transfers.create({
        idempotencyKey: v.idempotencyKey,
        fromAccountId: v.fromId,
        toAccountId: v.toId,
        sourceAmountMinor: decimalToMinor(v.amount, from!.currency),
        destinationAmountMinor: crossCurrency ? decimalToMinor(v.received, to!.currency) : undefined,
        transactionDate: v.date,
        description: v.description.trim() || undefined,
      }),
    success: (_r, v) => `Moved ${formatMoney(decimalToMinor(v.amount, from!.currency), from!.currency)} to ${to!.name}`,
    toastError: false,
    onSuccess: (_r, v) => onDone(v.fromId),
  })
  const submit = form.handleSubmit((v) => {
    if (mutation.isPending) return
    onPendingChange(true)
    mutation.mutate(
      { ...v, idempotencyKey: newIdempotencyKey() },
      { onError: (e) => applyFieldErrors(e, form.setError, { sourceAmountMinor: 'amount', destinationAmountMinor: 'received', toAccountId: 'toId', transactionDate: 'date' }), onSettled: () => onPendingChange(false) },
    )
  })
  if (eligible.length < 2) return <p className="rounded-md border border-dashed border-line bg-sunken/50 px-4 py-6 text-center text-sm text-muted">Transfers need at least two accounts.</p>
  return (
    <RecordingForm id={formId} onSubmit={submit} error={mutation.error}>
      <div className="grid gap-5 sm:grid-cols-2">
        <AccountSelect
          label="From"
          accounts={eligible}
          value={fromId}
          error={form.formState.errors.fromId?.message}
          onChange={(id) => {
            setFromId(id)
            form.setValue('fromId', id)
          }}
        />
        <AccountSelect
          label="To"
          accounts={eligible}
          exclude={fromId}
          value={toId}
          error={form.formState.errors.toId?.message}
          onChange={(id) => {
            setToId(id)
            form.setValue('toId', id)
          }}
        />
      </div>
      <Controller
        control={form.control}
        name="amount"
        render={({ field, fieldState }) => (
          <AmountField label={crossCurrency ? `Amount sent (${from!.currency})` : 'Amount'} currency={from?.currency ?? 'KES'} value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} autoFocus />
        )}
      />
      {crossCurrency ? (
        <Controller
          control={form.control}
          name="received"
          render={({ field, fieldState }) => (
            <AmountField
              label={`Amount received (${to!.currency})`}
              currency={to!.currency}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              hint="Enter what actually arrived, after conversion and fees."
            />
          )}
        />
      ) : null}
      <DateField label="Date" max={today} {...form.register('date')} error={form.formState.errors.date?.message} />
      <TextareaField label="Description" optional rows={2} {...form.register('description')} />
      <p className="text-xs text-muted">Transfers move money between your own accounts, so they never count as contributions or withdrawals.</p>
    </RecordingForm>
  )
}
