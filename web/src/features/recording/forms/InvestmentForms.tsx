import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Account, Instrument } from '@/api/types'
import { AmountField, DateField, SelectField, TextareaField, TextField } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { DateText, Quantity, UnitPrice } from '@/components/format'
import { UNIT_DECIMALS, decimalToMinor, minorToDecimal, minorExponent } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { newIdempotencyKey, useAccountAnalytics, useApiMutation, useInstruments } from '@/lib/queries'
import { accountAllows } from '../actions'
import { AccountSelect, applyFieldErrors, DecimalField, RecordingForm, useFocusFirstError } from '../shared'
import { NoEligibleAccounts } from './TransactionForm'

const positive = (label: string) =>
  z
    .string()
    .min(1, `Enter ${label}`)
    .refine((v) => /^\d*\.?\d+$/.test(v) && /[1-9]/.test(v), `Enter ${label} greater than zero`)

function instrumentOptions(list: Instrument[]) {
  return list.filter((i) => !i.archivedAt).map((i) => ({ value: i.id, label: `${i.symbol ? `${i.symbol} · ` : ''}${i.name} (${i.quoteCurrency})` }))
}

/** Buy or sell: moves value between cash and positions. Not a contribution or withdrawal. */
export function TradeForm({
  formId,
  side: initialSide,
  accounts,
  initialAccountId,
  initialInstrumentId,
  onDone,
  onPendingChange,
}: {
  formId: string
  side: 'buy' | 'sell'
  accounts: Account[]
  initialAccountId?: string
  initialInstrumentId?: string
  onDone(accountId: string, side: 'buy' | 'sell'): void
  onPendingChange(p: boolean): void
}) {
  const { today } = usePrefs()
  const [side, setSide] = useState(initialSide)
  const eligible = useMemo(() => accounts.filter((a) => accountAllows(a, 'buy')), [accounts])
  const [accountId, setAccountId] = useState(() => (eligible.some((a) => a.id === initialAccountId) ? initialAccountId! : (eligible[0]?.id ?? '')))
  const account = eligible.find((a) => a.id === accountId)
  const instruments = useInstruments()
  const analytics = useAccountAnalytics(accountId || undefined)
  const held = analytics.data?.positionSummary?.positions ?? []
  const options = side === 'sell' ? held.map((p) => ({ value: p.instrumentId, label: `${p.instrumentSymbol} · ${p.instrumentName}` })) : instrumentOptions(instruments.data ?? [])
  const schema = z.object({
    instrumentId: z.string().min(1, 'Choose an instrument'),
    quantity: positive('a quantity'),
    unitPrice: positive('a price'),
    fee: z.string(),
    date: z.string().min(1, 'Choose a date').refine((d) => d <= today, 'Choose today or an earlier date'),
    notes: z.string().max(1000),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { instrumentId: initialInstrumentId ?? '', quantity: '', unitPrice: '', fee: '', date: today, notes: '' },
  })
  useFocusFirstError(form.formState.errors, form.formState.submitCount)
  const instrumentId = useWatch({ control: form.control, name: 'instrumentId' })
  const instrument = instruments.data?.find((i) => i.id === instrumentId)
  const position = held.find((p) => p.instrumentId === instrumentId)

  const mutation = useApiMutation({
    mutationFn: (v: Values & { idempotencyKey: string }) =>
      api.positionEvents.create({
        idempotencyKey: v.idempotencyKey,
        accountId,
        instrumentId: v.instrumentId,
        type: side,
        quantity: v.quantity,
        unitPrice: v.unitPrice,
        tradeCurrency: instrument?.quoteCurrency,
        feeAmount: v.fee ? minorToDecimal(decimalToMinor(v.fee, account!.currency), account!.currency) : undefined,
        feeCurrency: v.fee ? account!.currency : undefined,
        tradeDate: v.date,
        notes: v.notes.trim() || undefined,
      }),
    success: (_r, v) => `${side === 'buy' ? 'Bought' : 'Sold'} ${v.quantity} ${instrument?.symbol ?? instrument?.name ?? 'units'}`,
    toastError: false,
    onSuccess: () => onDone(accountId, side),
  })
  const submit = form.handleSubmit((v) => {
    if (mutation.isPending) return
    onPendingChange(true)
    mutation.mutate(
      { ...v, idempotencyKey: newIdempotencyKey() },
      { onError: (e) => applyFieldErrors(e, form.setError, { quantity: 'quantity', unitPrice: 'unitPrice', instrumentId: 'instrumentId', tradeDate: 'date', feeAmount: 'fee' }), onSettled: () => onPendingChange(false) },
    )
  })
  if (eligible.length === 0) return <NoEligibleAccounts action={side} />
  return (
    <RecordingForm id={formId} onSubmit={submit} error={mutation.error}>
      <Segmented<'buy' | 'sell'>
        label="Trade side"
        value={side}
        onChange={(s) => {
          setSide(s)
          form.setValue('instrumentId', '')
        }}
        options={[
          { value: 'buy', label: 'Buy' },
          { value: 'sell', label: 'Sell' },
        ]}
      />
      <AccountSelect accounts={eligible} value={accountId} onChange={setAccountId} />
      <SelectField
        label="Instrument"
        {...form.register('instrumentId')}
        options={options}
        placeholder={side === 'sell' && held.length === 0 ? 'Nothing held in this account' : 'Choose an instrument'}
        error={form.formState.errors.instrumentId?.message}
        hint={
          side === 'sell' && position ? (
            <>
              You hold <Quantity value={position.quantity} /> {position.instrumentSymbol}
            </>
          ) : side === 'buy' ? (
            'New instrument? Add it in Settings → Instruments first.'
          ) : undefined
        }
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="quantity"
          render={({ field, fieldState }) => <DecimalField label="Quantity" value={field.value} onChange={field.onChange} error={fieldState.error?.message} suffix={instrument?.symbol ?? 'units'} />}
        />
        <Controller
          control={form.control}
          name="unitPrice"
          render={({ field, fieldState }) => (
            <AmountField label="Unit price" currency={instrument?.quoteCurrency ?? account?.currency ?? 'KES'} decimals={UNIT_DECIMALS} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
          )}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="fee"
          render={({ field, fieldState }) => <AmountField label="Fee" optional currency={account?.currency ?? 'KES'} decimals={minorExponent(account?.currency ?? 'KES')} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />}
        />
        <DateField label="Trade date" max={today} {...form.register('date')} error={form.formState.errors.date?.message} />
      </div>
      <TextareaField label="Notes" optional rows={2} {...form.register('notes')} />
      <p className="text-xs text-muted">Trades move value between cash and holdings inside the account. They are not contributions or withdrawals.</p>
    </RecordingForm>
  )
}

/** Update a unit price (effective-dated). Changes market value without changing quantity. */
export function PriceForm({ formId, initialInstrumentId, onDone, onPendingChange }: { formId: string; initialInstrumentId?: string; onDone(): void; onPendingChange(p: boolean): void }) {
  const { today } = usePrefs()
  const instruments = useInstruments()
  const list = (instruments.data ?? []).filter((i) => !i.archivedAt)
  const schema = z.object({
    instrumentId: z.string().min(1, 'Choose an instrument'),
    price: positive('a price'),
    date: z.string().min(1, 'Choose a date').refine((d) => d <= today, 'Choose today or an earlier date'),
    provenance: z.string().max(200),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { instrumentId: initialInstrumentId ?? list[0]?.id ?? '', price: '', date: today, provenance: '' }, resetOptions: { keepDirtyValues: true } })
  useFocusFirstError(form.formState.errors, form.formState.submitCount)
  const watchedId = useWatch({ control: form.control, name: 'instrumentId' })
  const instrument = list.find((i) => i.id === watchedId)
  const mutation = useApiMutation({
    mutationFn: (v: Values & { idempotencyKey: string }) =>
      api.prices.upsert({ instrumentId: v.instrumentId, price: v.price, effectiveDate: v.date, source: 'manual', provenance: v.provenance.trim() || undefined }, { idempotencyKey: v.idempotencyKey }),
    success: (_r, v) => `${instrument?.symbol ?? 'Price'} updated to ${instrument?.quoteCurrency ?? ''} ${v.price}`,
    toastError: false,
    onSuccess: () => onDone(),
  })
  const submit = form.handleSubmit((v) => {
    if (mutation.isPending) return
    onPendingChange(true)
    mutation.mutate({ ...v, idempotencyKey: newIdempotencyKey() }, { onError: (e) => applyFieldErrors(e, form.setError, { price: 'price', effectiveDate: 'date' }), onSettled: () => onPendingChange(false) })
  })
  if (!instruments.isPending && list.length === 0) return <NoEligibleAccounts action="price" />
  return (
    <RecordingForm id={formId} onSubmit={submit} error={mutation.error}>
      <SelectField
        label="Instrument"
        {...form.register('instrumentId')}
        options={instrumentOptions(list)}
        placeholder="Choose an instrument"
        error={form.formState.errors.instrumentId?.message}
        hint={
          instrument?.latestPrice ? (
            <>
              Latest <UnitPrice value={instrument.latestPrice.price} currency={instrument.quoteCurrency} /> on <DateText value={instrument.latestPrice.effectiveDate} />
            </>
          ) : instrument ? (
            'No price recorded yet — values that depend on it are incomplete.'
          ) : undefined
        }
      />
      <Controller
        control={form.control}
        name="price"
        render={({ field, fieldState }) => <AmountField label="Unit price" currency={instrument?.quoteCurrency ?? 'KES'} decimals={UNIT_DECIMALS} value={field.value} onChange={field.onChange} error={fieldState.error?.message} autoFocus />}
      />
      <DateField label="Price date" max={today} {...form.register('date')} error={form.formState.errors.date?.message} hint="The day this price applies from." />
      <TextField label="Source" optional placeholder="For example: broker statement, exchange close" {...form.register('provenance')} />
    </RecordingForm>
  )
}
