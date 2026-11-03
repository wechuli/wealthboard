/**
 * The full position-event editor: opening positions, buys, sells, and quantity adjustments, with fees,
 * settlement cash, applied rate, trade currency, and reference fields. Creating and correcting both replay
 * the account's later history on the server.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { Account, AccountPosition, Instrument, PositionEvent, PositionEventUpdateRequest } from '@/api/types'
import { DateText, Money, Quantity } from '@/components/format'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog'
import { DateField, SelectField, TextareaField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { activityLabel } from '@/features/accounts/model'
import { UNIT_DECIMALS, absMinor, minorExponent, minorSign, minorToDecimal } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation, useInstruments, usePositionEvent } from '@/lib/queries'
import { groupActionLabel } from './advanced-meta'
import { UndoGroupDialog, type UndoTarget } from './undo'
import {
  Consequences,
  DecimalInput,
  FormSection,
  WorkflowProblem,
  decimalMessage,
  instrumentLabel,
  isNonNegativeDecimal,
  isNonZeroSignedDecimal,
  isPositiveDecimal,
  moneyDecimal,
  optional,
  useAttemptKey,
} from './workflow-kit'

export type TradeType = 'opening_position' | 'buy' | 'sell' | 'quantity_adjustment'
export const EDITABLE_TYPES: readonly string[] = ['opening_position', 'buy', 'sell', 'quantity_adjustment']

const TYPE_HELP: Record<TradeType, string> = {
  opening_position: 'Units you already held when tracking started. No cash moves.',
  buy: 'Cash pays for units. Not a contribution.',
  sell: 'Units become cash. Not a withdrawal.',
  quantity_adjustment: 'Corrects the unit count without cash, such as a broker rounding fix. Use a minus sign to reduce.',
}

const SUCCESS: Record<TradeType, string> = {
  opening_position: 'Opening position recorded',
  buy: 'Buy recorded',
  sell: 'Sell recorded',
  quantity_adjustment: 'Quantity adjustment recorded',
}

const TRADE_CAUSES = [
  'A sale or negative adjustment is larger than the quantity held on that date, counting every earlier event.',
  'A later sale, transfer, or corporate action would no longer have enough units after this change. Every later event is replayed.',
  'The trade currency differs from the account currency and no settlement cash or applied rate was given, and no saved exchange rate covers the trade date.',
  'An applied rate was entered for a trade in the account currency. Rates are only for cross-currency trades.',
  'The instrument is archived, or the date is in the future.',
]

interface Values {
  type: TradeType
  instrumentId: string
  quantity: string
  unitPrice: string
  tradeCurrency: string
  feeAmount: string
  feeCurrency: string
  cashEffect: string
  appliedExchangeRate: string
  openingCostBasis: string
  tradeDate: string
  settlementDate: string
  externalId: string
  description: string
  notes: string
}

function valuesFromEvent(e: PositionEvent, account: Account): Values {
  const cross = e.tradeCurrency !== account.currency
  const explicitCash = cross && !e.appliedExchangeRate && e.cashEffectMinor !== '0'
  const feeCurrency = e.feeCurrency ?? e.tradeCurrency
  return {
    type: (EDITABLE_TYPES.includes(e.type) ? e.type : 'buy') as TradeType,
    instrumentId: e.instrumentId,
    quantity: e.quantity,
    unitPrice: e.unitPrice ?? '',
    tradeCurrency: e.tradeCurrency,
    feeAmount: e.feeAmountMinor && e.feeAmountMinor !== '0' ? minorToDecimal(e.feeAmountMinor, feeCurrency) : '',
    feeCurrency,
    cashEffect: explicitCash ? minorToDecimal(absMinor(e.cashEffectMinor), account.currency) : '',
    appliedExchangeRate: e.appliedExchangeRate ?? '',
    openingCostBasis: e.openingCostBasisMinor ? minorToDecimal(e.openingCostBasisMinor, account.currency) : '',
    tradeDate: e.tradeDate,
    settlementDate: e.settlementDate ?? '',
    externalId: e.externalId ?? '',
    description: e.description ?? '',
    notes: e.notes ?? '',
  }
}

export function TradeSheet({
  account,
  positions,
  positionsReady,
  open,
  onOpenChange,
  eventId,
  initialType = 'opening_position',
  initialInstrumentId,
}: {
  account: Account
  positions: AccountPosition[]
  positionsReady: boolean
  open: boolean
  onOpenChange(o: boolean): void
  eventId?: string
  initialType?: TradeType
  initialInstrumentId?: string
}) {
  const event = usePositionEvent(eventId ? account.id : undefined, eventId)
  const instruments = useInstruments()
  const [deleting, setDeleting] = useState(false)
  const [pending, setPending] = useState(false)
  const [undo, setUndo] = useState<UndoTarget | null>(null)
  const editing = !!eventId
  const close = () => onOpenChange(false)

  let body: React.ReactNode
  let footer: React.ReactNode = (
    <Button variant="ghost" onClick={close}>
      Close
    </Button>
  )
  if ((editing && event.isPending) || instruments.isPending || !positionsReady) {
    body = (
      <div className="space-y-4" role="status" aria-label="Loading trade">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
        <Skeleton className="h-24" />
      </div>
    )
  } else if (editing && event.isError) {
    const gone = ApiProblem.is(event.error) && event.error.status === 404
    body = gone ? (
      <Notice tone="info" title="This trade no longer exists">
        It may have been deleted, or it belongs to a different account. Close this and check the account's activity.
      </Notice>
    ) : (
      <WorkflowProblem error={event.error} />
    )
  } else if (editing && event.data && (event.data.eventGroupId || !EDITABLE_TYPES.includes(event.data.type))) {
    const e = event.data
    const label = groupActionLabel(e.type)
    body = (
      <Notice tone="info" title={`Part of a ${label}`}>
        {activityLabel(e.type)} events are written as one group with the {label}, so they can't be edited one at a time. Undo the whole action, then record it again with the right details.
      </Notice>
    )
    footer = (
      <>
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
        {e.eventGroupId ? (
          <Button variant="danger" onClick={() => setUndo({ eventId: e.id, label, date: e.tradeDate })}>
            Undo {label}
          </Button>
        ) : null}
      </>
    )
  } else {
    body = (
      <TradeForm
        account={account}
        positions={positions}
        instruments={instruments.data ?? []}
        event={editing ? event.data : undefined}
        initialType={initialType}
        initialInstrumentId={initialInstrumentId}
        onDone={close}
        onPendingChange={setPending}
      />
    )
    footer = <TradeFooter editing={editing} pending={pending} onCancel={close} onDelete={() => setDeleting(true)} />
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        width="lg"
        title={editing ? 'Edit trade' : 'Record position activity'}
        description={editing ? 'Every later quantity, cash balance, and value is replayed when you save.' : `Holdings and cash in ${account.name}, recorded exactly.`}
        footer={footer}
      >
        {body}
      </Sheet>
      {editing && event.data ? <DeleteTradeDialog account={account} event={event.data} open={deleting} onOpenChange={setDeleting} onDeleted={close} /> : null}
      <UndoGroupDialog
        target={undo}
        onClose={() => {
          setUndo(null)
        }}
      />
    </>
  )
}

function TradeFooter({ editing, pending, onCancel, onDelete }: { editing: boolean; pending: boolean; onCancel(): void; onDelete(): void }) {
  const online = useOnline()
  return (
    <>
      {editing ? (
        <Button variant="ghost" className="mr-auto text-negative hover:text-negative" icon={<Trash2 size={16} aria-hidden />} onClick={onDelete} disabled={!online}>
          Delete
        </Button>
      ) : null}
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" form="trade-form" variant="primary" loading={pending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
        {editing ? 'Save and replay' : 'Record'}
      </Button>
    </>
  )
}

function TradeForm({
  account,
  positions,
  instruments,
  event,
  initialType,
  initialInstrumentId,
  onDone,
  onPendingChange,
}: {
  account: Account
  positions: AccountPosition[]
  instruments: Instrument[]
  event?: PositionEvent
  initialType: TradeType
  initialInstrumentId?: string
  onDone(): void
  onPendingChange(p: boolean): void
}) {
  const { today, enabledCurrencies } = usePrefs()
  const attempt = useAttemptKey()
  const c = account.currency
  const firstInstrument = instruments.find((i) => i.id === initialInstrumentId && !i.archivedAt)
  const defaults: Values = event
    ? valuesFromEvent(event, account)
    : {
        type: initialType,
        instrumentId: firstInstrument?.id ?? '',
        quantity: '',
        unitPrice: '',
        tradeCurrency: firstInstrument?.quoteCurrency ?? c,
        feeAmount: '',
        feeCurrency: firstInstrument?.quoteCurrency ?? c,
        cashEffect: '',
        appliedExchangeRate: '',
        openingCostBasis: '',
        tradeDate: today,
        settlementDate: '',
        externalId: '',
        description: '',
        notes: '',
      }

  const schema = z
    .object({
      type: z.enum(['opening_position', 'buy', 'sell', 'quantity_adjustment']),
      instrumentId: z.string().min(1, 'Choose an instrument'),
      quantity: z.string(),
      unitPrice: z.string(),
      tradeCurrency: z.string().regex(/^[A-Z]{3}$/, 'Choose a currency'),
      feeAmount: z.string(),
      feeCurrency: z.string(),
      cashEffect: z.string(),
      appliedExchangeRate: z.string(),
      openingCostBasis: z.string(),
      tradeDate: z
        .string()
        .min(1, 'Choose the trade date')
        .refine((d) => d <= today, 'Choose today or an earlier date'),
      settlementDate: z.string(),
      externalId: z.string().trim().max(200, 'Keep the external ID under 200 characters'),
      description: z.string().max(200, 'Keep the description under 200 characters'),
      notes: z.string().max(2000, 'Keep notes under 2,000 characters'),
    })
    .superRefine((v, ctx) => {
      const issue = (path: keyof Values, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
      const priced = v.type === 'buy' || v.type === 'sell'
      if (v.type === 'quantity_adjustment') {
        if (!isNonZeroSignedDecimal(v.quantity)) issue('quantity', decimalMessage.signed)
      } else if (!isPositiveDecimal(v.quantity)) issue('quantity', decimalMessage.positive)
      if (priced && !isPositiveDecimal(v.unitPrice)) issue('unitPrice', v.unitPrice ? decimalMessage.positive : 'Enter the price per unit')
      if (v.type === 'opening_position' && v.unitPrice && !isPositiveDecimal(v.unitPrice)) issue('unitPrice', decimalMessage.positive)
      if (priced && v.feeAmount && !isNonNegativeDecimal(v.feeAmount)) issue('feeAmount', decimalMessage.nonNegative)
      if (priced && v.cashEffect && !isPositiveDecimal(v.cashEffect)) issue('cashEffect', decimalMessage.positive)
      if (priced && v.tradeCurrency !== c && v.appliedExchangeRate && !isPositiveDecimal(v.appliedExchangeRate)) issue('appliedExchangeRate', decimalMessage.positive)
      if (v.type === 'opening_position' && v.openingCostBasis && !isNonNegativeDecimal(v.openingCostBasis)) issue('openingCostBasis', decimalMessage.nonNegative)
      if (v.settlementDate && v.settlementDate < v.tradeDate) issue('settlementDate', 'Settlement can’t be before the trade date')
    })

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults })
  const errors = form.formState.errors
  const [type, instrumentId, tradeCurrency, feeCurrency, tradeDate] = useWatch({ control: form.control, name: ['type', 'instrumentId', 'tradeCurrency', 'feeCurrency', 'tradeDate'] })
  const instrument = instruments.find((i) => i.id === instrumentId)
  const held = positions.find((p) => p.instrumentId === instrumentId)
  const priced = type === 'buy' || type === 'sell'
  const cross = tradeCurrency !== c

  const currencies = [...new Set([...enabledCurrencies, c, instrument?.quoteCurrency, event?.tradeCurrency, event?.feeCurrency].filter((x): x is string => !!x))].sort()
  const currencyOptions = currencies.map((x) => ({ value: x, label: x }))
  const instrumentOptions = instruments
    .filter((i) => !i.archivedAt || i.id === event?.instrumentId)
    .map((i) => ({ value: i.id, label: `${instrumentLabel(i)}${i.archivedAt ? ' · archived' : ''}`, disabled: !!i.archivedAt && i.id !== event?.instrumentId }))

  const toRequest = (v: Values): Omit<PositionEventUpdateRequest, 'idempotencyKey'> => {
    const isPriced = v.type === 'buy' || v.type === 'sell'
    const fee = isPriced && v.feeAmount ? v.feeAmount : ''
    return {
      accountId: account.id,
      instrumentId: v.instrumentId,
      type: v.type,
      quantity: v.quantity.trim(),
      unitPrice: isPriced || v.type === 'opening_position' ? optional(v.unitPrice) : undefined,
      tradeCurrency: v.tradeCurrency,
      feeAmount: fee ? moneyDecimal(fee, v.feeCurrency || v.tradeCurrency) : undefined,
      feeCurrency: fee ? v.feeCurrency || v.tradeCurrency : undefined,
      cashEffect: isPriced && v.cashEffect ? moneyDecimal(v.cashEffect, c) : undefined,
      appliedExchangeRate: isPriced && v.tradeCurrency !== c ? optional(v.appliedExchangeRate) : undefined,
      openingCostBasis: v.type === 'opening_position' && v.openingCostBasis ? moneyDecimal(v.openingCostBasis, c) : undefined,
      tradeDate: v.tradeDate,
      settlementDate: optional(v.settlementDate),
      externalId: optional(v.externalId),
      description: optional(v.description),
      notes: optional(v.notes),
    }
  }

  const save = useApiMutation({
    mutationFn: (v: Values) => {
      const body = toRequest(v)
      const idempotencyKey = attempt.keyFor(body)
      return event ? api.positionEvents.update(event.id, { ...body, idempotencyKey }) : api.positionEvents.create({ ...body, idempotencyKey })
    },
    success: (_r, v) => (event ? 'Trade updated. Later history was replayed.' : SUCCESS[v.type]),
    toastError: false,
    onSuccess: () => {
      attempt.reset()
      onDone()
    },
  })
  const submit = form.handleSubmit((v) => {
    if (save.isPending) return
    onPendingChange(true)
    save.mutate(v, { onSettled: () => onPendingChange(false) })
  })

  const onInstrumentChange = (id: string) => {
    form.setValue('instrumentId', id, { shouldValidate: form.formState.isSubmitted })
    const next = instruments.find((i) => i.id === id)
    if (next && !event) {
      form.setValue('tradeCurrency', next.quoteCurrency)
      form.setValue('feeCurrency', next.quoteCurrency)
    }
  }

  return (
    <form id="trade-form" onSubmit={submit} noValidate className="space-y-6">
      {event ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-line bg-sunken/60 px-3.5 py-2.5 text-sm">
          <span className="text-muted">
            Recorded as {activityLabel(event.type).toLowerCase()} on <DateText value={event.tradeDate} />
          </span>
          <span className="text-muted">
            Cash effect <Money minor={event.cashEffectMinor} currency={c} sign={minorSign(event.cashEffectMinor) === 0 ? 'auto' : 'always'} className="font-medium text-ink" />
          </span>
        </div>
      ) : null}

      <div>
        <p aria-hidden className="mb-1.5 text-sm font-medium text-ink">
          Event type
        </p>
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <Segmented<TradeType>
              label="Event type"
              value={field.value}
              onChange={(t) => field.onChange(t)}
              className="flex w-full [&>*]:flex-1"
              options={[
                { value: 'opening_position', label: 'Opening' },
                { value: 'buy', label: 'Buy' },
                { value: 'sell', label: 'Sell' },
                { value: 'quantity_adjustment', label: 'Adjust', ariaLabel: 'Quantity adjustment' },
              ]}
            />
          )}
        />
        <p className="mt-1.5 text-xs text-muted">{TYPE_HELP[type]}</p>
      </div>

      <FormSection title="Units">
        <SelectField
          label="Instrument"
          value={instrumentId}
          onChange={(e) => onInstrumentChange(e.target.value)}
          options={instrumentOptions}
          placeholder={instrumentOptions.length ? 'Choose an instrument' : 'No instruments yet'}
          error={errors.instrumentId?.message}
          hint={
            held ? (
              <>
                Holding <Quantity value={held.quantity} /> {held.instrumentSymbol || 'units'} today
              </>
            ) : (
              <>
                New instrument?{' '}
                <Link to="/settings/instruments?new=1" className="link">
                  Add it in settings
                </Link>
                .
              </>
            )
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="quantity"
            render={({ field, fieldState }) => (
              <DecimalInput
                label={type === 'quantity_adjustment' ? 'Quantity change' : 'Quantity'}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                allowNegative={type === 'quantity_adjustment'}
                suffix={instrument?.symbol ?? 'units'}
              />
            )}
          />
          {type !== 'quantity_adjustment' ? (
            <Controller
              control={form.control}
              name="unitPrice"
              render={({ field, fieldState }) => (
                <DecimalInput
                  label="Unit price"
                  optional={type === 'opening_position'}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  prefix={tradeCurrency}
                  hint={type === 'opening_position' ? 'Reference only. Add a price update to value the holding.' : 'Execution price per unit.'}
                />
              )}
            />
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Trade currency"
            {...form.register('tradeCurrency')}
            options={currencyOptions}
            error={errors.tradeCurrency?.message}
            hint={instrument ? `Quoted in ${instrument.quoteCurrency}` : undefined}
          />
          <DateField label="Trade date" max={today} {...form.register('tradeDate')} error={errors.tradeDate?.message} />
        </div>
        {type === 'opening_position' ? (
          <Controller
            control={form.control}
            name="openingCostBasis"
            render={({ field, fieldState }) => (
              <DecimalInput
                label="Opening cost basis"
                optional
                decimals={minorExponent(c)}
                prefix={c}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                hint="What you paid in total, kept for reference. It never affects value."
              />
            )}
          />
        ) : null}
      </FormSection>

      {priced ? (
        <FormSection title="Cash and fees" description={`Settles in ${c}, the account currency.`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="feeAmount"
              render={({ field, fieldState }) => (
                <DecimalInput
                  label="Fee"
                  optional
                  decimals={minorExponent(feeCurrency || tradeCurrency)}
                  prefix={feeCurrency || tradeCurrency}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
            <SelectField label="Fee currency" {...form.register('feeCurrency')} options={currencyOptions} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="cashEffect"
              render={({ field, fieldState }) => (
                <DecimalInput
                  label={type === 'buy' ? 'Cash paid' : 'Cash received'}
                  optional
                  decimals={minorExponent(c)}
                  prefix={c}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  hint={cross ? `The actual ${c} settlement, fees included. Or give the applied rate.` : 'Leave empty to use quantity × price and the fee. If entered, the fee isn’t added again.'}
                />
              )}
            />
            {cross ? (
              <Controller
                control={form.control}
                name="appliedExchangeRate"
                render={({ field, fieldState }) => (
                  <DecimalInput
                    label={`Applied rate (${tradeCurrency} → ${c})`}
                    optional
                    decimals={UNIT_DECIMALS}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    hint={`${c} per 1 ${tradeCurrency}, as the broker applied it.`}
                  />
                )}
              />
            ) : null}
          </div>
          {cross ? (
            <p className="text-xs text-muted">
              Without settlement cash or an applied rate, Wealthboard uses your saved {tradeCurrency}/{c} rate on <DateText value={tradeDate || today} />. It never substitutes a later market rate.
            </p>
          ) : null}
        </FormSection>
      ) : null}

      <FormSection title="Reference">
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField label="Settlement date" optional min={tradeDate} {...form.register('settlementDate')} error={errors.settlementDate?.message} />
          <TextField label="External ID" optional {...form.register('externalId')} error={errors.externalId?.message} autoComplete="off" hint="The broker's reference, so imports recognise it." />
        </div>
        <TextField label="Description" optional {...form.register('description')} error={errors.description?.message} autoComplete="off" />
        <TextareaField label="Notes" optional rows={2} {...form.register('notes')} error={errors.notes?.message} />
      </FormSection>

      <Consequences
        items={
          event
            ? [
                <>
                  Every event from <DateText value={tradeDate || event.tradeDate} /> onwards is replayed: quantities, cash, and account values are recalculated.
                </>,
                'If any later sale or corporate action would then need more units than you hold, nothing is saved.',
              ]
            : [
                type === 'buy' || type === 'sell'
                  ? 'Cash and holdings move inside the account. Net worth changes only by fees and price differences.'
                  : 'No cash moves. The holding counts once it has a price.',
                'A backdated entry replays every later event for this account.',
              ]
        }
      />

      <WorkflowProblem error={save.error} causes={TRADE_CAUSES} />
    </form>
  )
}

function DeleteTradeDialog({ account, event, open, onOpenChange, onDeleted }: { account: Account; event: PositionEvent; open: boolean; onOpenChange(o: boolean): void; onDeleted(): void }) {
  const online = useOnline()
  const remove = useApiMutation({
    mutationFn: () => api.positionEvents.remove(event.id),
    success: 'Trade deleted. Later history was replayed.',
    toastError: false,
    onSuccess: () => {
      onOpenChange(false)
      onDeleted()
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) remove.reset()
        onOpenChange(o)
      }}
      title={`Delete this ${activityLabel(event.type).toLowerCase()}?`}
      description={`Quantities, cash, and values in ${account.name} replay from that date. If a later sale needs these units, nothing is deleted.`}
      confirmLabel="Delete trade"
      pending={remove.isPending}
      confirmDisabled={!online}
      onConfirm={() => remove.mutate(undefined)}
    >
      <p className="text-sm text-muted">
        <Quantity value={event.quantity} /> units on <DateText value={event.tradeDate} />
      </p>
      <WorkflowProblem error={remove.error} className="mt-3" causes={['A later sale, transfer, or corporate action needs the units this event added. Correct or remove that first.']} />
    </ConfirmDialog>
  )
}
