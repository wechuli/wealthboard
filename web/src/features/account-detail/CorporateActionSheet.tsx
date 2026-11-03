/** Corporate actions: split, spin-off, merger, dividend reinvestment, and in-kind transfer. Each commits as one undoable group. */
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronLeft, ChevronRight, Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { api } from '@/api'
import type { Account, AccountPosition, CorporateActionKind, CorporateActionRequest, Instrument, PositionEvent } from '@/api/types'
import { DateText, Quantity } from '@/components/format'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Dialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { AmountField, DateField, SelectField, TextareaField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { UNIT_DECIMALS, minorExponent } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useAccounts, useApiMutation, useInstruments, usePositionEvents } from '@/lib/queries'
import { ADVANCED_META, CORPORATE_KINDS, groupActionLabel, type CorporateKind } from './advanced-meta'
import { UndoGroupDialog, type UndoTarget } from './undo'
import {
  Consequences,
  DecimalInput,
  FormSection,
  WorkflowProblem,
  compareDecimal,
  decimalMessage,
  instrumentLabel,
  isNonNegativeDecimal,
  isPositiveDecimal,
  moneyDecimal,
  optional,
  positionLabel,
  useAttemptKey,
} from './workflow-kit'

const ENDPOINT: Record<CorporateKind, CorporateActionKind> = {
  split: 'stock-splits',
  spinoff: 'spinoffs',
  merger: 'mergers',
  drip: 'dividend-reinvestments',
  inkind: 'in-kind-transfers',
}

interface SheetProps {
  account: Account
  positions: AccountPosition[]
  open: boolean
  onOpenChange(o: boolean): void
}

const symbolOf = (i: Pick<Instrument, 'symbol' | 'name'> | undefined, fallback: string) => i?.symbol || i?.name || fallback

// ---- chooser ----------------------------------------------------------------------

export function CorporateChooserSheet({ account, open, onOpenChange, onChoose }: SheetProps & { onChoose(kind: CorporateKind): void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Corporate actions"
      description="Events your broker applies to a holding. Each is recorded as one group you can undo."
      footer={
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="space-y-6">
        <ul className="space-y-2" aria-label="Choose a corporate action">
          {CORPORATE_KINDS.map((k) => {
            const m = ADVANCED_META[k]
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => onChoose(k)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-left transition-colors duration-[var(--dur-1)] hover:border-line-strong hover:bg-sunken/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <m.icon size={17} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{m.label}</span>
                    <span className="block text-xs text-muted">{m.description}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden className="shrink-0 text-subtle" />
                </button>
              </li>
            )
          })}
        </ul>
        <RecordedGroups account={account} />
      </div>
    </Sheet>
  )
}

/** Corporate-action groups already recorded in this account, newest first, each undoable. */
function RecordedGroups({ account }: { account: Account }) {
  const events = usePositionEvents(account.id, { limit: 100 })
  const instruments = useInstruments()
  const [undo, setUndo] = useState<UndoTarget | null>(null)
  const name = (id: string | undefined) => {
    const i = instruments.data?.find((x) => x.id === id)
    return i ? symbolOf(i, 'instrument') : undefined
  }
  const groups = new Map<string, PositionEvent[]>()
  for (const e of events.data?.items ?? []) {
    if (!e.eventGroupId) continue
    const list = groups.get(e.eventGroupId) ?? []
    list.push(e)
    groups.set(e.eventGroupId, list)
  }
  const rows = [...groups.values()]
    .map((list) => {
      const head = list.find((e) => e.type !== 'merger_in' && e.type !== 'transfer_in') ?? list[0]!
      const label = groupActionLabel(head.type)
      const symbols = [...new Set(list.flatMap((e) => [name(e.instrumentId), name(e.relatedInstrumentId)]).filter((x): x is string => !!x))]
      return { head, label, detail: symbols.join(' → ') }
    })
    .sort((a, b) => (a.head.tradeDate < b.head.tradeDate ? 1 : -1))

  return (
    <section aria-labelledby="recorded-groups" className="space-y-2">
      <h3 id="recorded-groups" className="text-sm font-semibold text-ink">
        Recorded in {account.name}
      </h3>
      {events.isPending ? (
        <Skeleton className="h-20" />
      ) : events.isError ? (
        <ErrorState compact error={events.error} onRetry={() => void events.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No corporate actions yet. Once recorded, each appears here and in the activity feed as one entry.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.head.eventGroupId} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium capitalize text-ink">{r.label}</p>
                <p className="truncate text-xs text-muted">
                  <DateText value={r.head.tradeDate} />
                  {r.detail ? ` · ${r.detail}` : ''}
                </p>
              </div>
              <Button size="sm" variant="ghost" icon={<Undo2 size={15} aria-hidden />} onClick={() => setUndo({ eventId: r.head.id, label: r.label, date: r.head.tradeDate, detail: r.detail })}>
                Undo
              </Button>
            </li>
          ))}
        </ul>
      )}
      <UndoGroupDialog target={undo} onClose={() => setUndo(null)} />
    </section>
  )
}

// ---- one action -------------------------------------------------------------------

interface Values {
  instrumentId: string
  relatedInstrumentId: string
  destinationAccountId: string
  numerator: string
  denominator: string
  dividendAmount: string
  quantity: string
  unitPrice: string
  tradeCurrency: string
  feeAmount: string
  feeCurrency: string
  cashEffect: string
  appliedExchangeRate: string
  date: string
  notes: string
}

const RATIO_KINDS: CorporateKind[] = ['split', 'spinoff', 'merger']

function causesFor(kind: CorporateKind, c: string): string[] {
  switch (kind) {
    case 'split':
      return ['Nothing is held in this instrument on the effective date.', 'A later event for this instrument conflicts with the new quantity.']
    case 'spinoff':
      return ['Nothing is held in the source instrument on that date.', 'The new instrument is archived.']
    case 'merger':
      return ['Nothing is held in the source instrument on that date.', 'The destination instrument is archived.']
    case 'drip':
      return [
        `The trade currency differs from ${c} and neither the cash paid nor an applied rate was entered.`,
        `An applied rate was entered for a trade in ${c}. Rates are only for cross-currency trades.`,
        'A currency used here is not enabled in settings, or the instrument is archived.',
      ]
    case 'inkind':
      return ['The quantity is more than this account holds on the transfer date.', 'A later sale in this account needs the units being moved.', 'The destination is archived or not position-tracked.']
  }
}

export function CorporateActionSheet({ account, positions, positionsReady, open, onOpenChange, kind, onBack }: SheetProps & { positionsReady: boolean; kind: CorporateKind; onBack(): void }) {
  const online = useOnline()
  const [pending, setPending] = useState(false)
  const meta = ADVANCED_META[kind]
  const nothingHeld = positionsReady && kind !== 'drip' && positions.length === 0
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={meta.label}
      description={meta.description}
      footer={
        <>
          <Button variant="ghost" icon={<ChevronLeft size={16} aria-hidden />} className="mr-auto" onClick={onBack}>
            All actions
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="corporate-action" variant="primary" loading={pending} disabled={!online || nothingHeld || !positionsReady} title={online ? undefined : OFFLINE_REASON}>
            Record {meta.label.toLowerCase()}
          </Button>
        </>
      }
    >
      {positionsReady ? (
        <CorporateActionForm account={account} positions={positions} kind={kind} onDone={() => onOpenChange(false)} onPendingChange={setPending} />
      ) : (
        <div className="space-y-4" role="status" aria-label="Loading holdings">
          <Skeleton className="h-10" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
          <Skeleton className="h-24" />
        </div>
      )}
    </Sheet>
  )
}

function CorporateActionForm({
  account,
  positions,
  kind,
  onDone,
  onPendingChange,
}: {
  account: Account
  positions: AccountPosition[]
  kind: CorporateKind
  onDone(): void
  onPendingChange(p: boolean): void
}) {
  const { today, enabledCurrencies } = usePrefs()
  const instruments = useInstruments()
  const accounts = useAccounts('active')
  const attempt = useAttemptKey()
  const c = account.currency
  const meta = ADVANCED_META[kind]
  const active = (instruments.data ?? []).filter((i) => !i.archivedAt)
  const destinations = (accounts.data ?? []).filter((a) => a.id !== account.id && a.trackingMode === 'positions' && !a.archivedAt && !a.isLiability)
  const first = positions[0]

  const schema = z
    .object({
      instrumentId: z.string().min(1, 'Choose an instrument'),
      relatedInstrumentId: z.string(),
      destinationAccountId: z.string(),
      numerator: z.string(),
      denominator: z.string(),
      dividendAmount: z.string(),
      quantity: z.string(),
      unitPrice: z.string(),
      tradeCurrency: z.string(),
      feeAmount: z.string(),
      feeCurrency: z.string(),
      cashEffect: z.string(),
      appliedExchangeRate: z.string(),
      date: z
        .string()
        .min(1, 'Choose the effective date')
        .refine((d) => d <= today, 'Choose today or an earlier date'),
      notes: z.string().max(2000, 'Keep notes under 2,000 characters'),
    })
    .superRefine((v, ctx) => {
      const issue = (path: keyof Values, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
      if (RATIO_KINDS.includes(kind)) {
        const nOk = isPositiveDecimal(v.numerator)
        const dOk = isPositiveDecimal(v.denominator)
        if (!nOk) issue('numerator', decimalMessage.positive)
        if (!dOk) issue('denominator', decimalMessage.positive)
        if (kind === 'split' && nOk && dOk && compareDecimal(v.numerator, v.denominator) === 0) issue('numerator', 'A ratio of 1 changes nothing. Use the split terms, such as 2 for 1.')
      }
      if (kind === 'spinoff' || kind === 'merger') {
        if (!v.relatedInstrumentId) issue('relatedInstrumentId', kind === 'spinoff' ? 'Choose the new instrument' : 'Choose the instrument you receive')
        else if (v.relatedInstrumentId === v.instrumentId) issue('relatedInstrumentId', 'Choose a different instrument from the source')
      }
      if (kind === 'drip') {
        if (!isPositiveDecimal(v.dividendAmount)) issue('dividendAmount', decimalMessage.positive)
        if (!isPositiveDecimal(v.quantity)) issue('quantity', decimalMessage.positive)
        if (!isPositiveDecimal(v.unitPrice)) issue('unitPrice', decimalMessage.positive)
        if (!/^[A-Z]{3}$/.test(v.tradeCurrency)) issue('tradeCurrency', 'Choose a currency')
        if (v.feeAmount && !isNonNegativeDecimal(v.feeAmount)) issue('feeAmount', decimalMessage.nonNegative)
        if (v.tradeCurrency !== c && v.cashEffect && !isPositiveDecimal(v.cashEffect)) issue('cashEffect', decimalMessage.positive)
        if (v.tradeCurrency !== c && v.appliedExchangeRate && !isPositiveDecimal(v.appliedExchangeRate)) issue('appliedExchangeRate', decimalMessage.positive)
      }
      if (kind === 'inkind') {
        if (!v.destinationAccountId) issue('destinationAccountId', 'Choose the account receiving the units')
        if (!isPositiveDecimal(v.quantity)) issue('quantity', decimalMessage.positive)
        if (v.feeAmount && !isNonNegativeDecimal(v.feeAmount)) issue('feeAmount', decimalMessage.nonNegative)
      }
    })

  const firstQuote = kind === 'drip' ? (active.find((i) => i.id === first?.instrumentId)?.quoteCurrency ?? c) : c
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      instrumentId: first?.instrumentId ?? '',
      relatedInstrumentId: '',
      destinationAccountId: '',
      numerator: kind === 'split' ? '2' : '1',
      denominator: '1',
      dividendAmount: '',
      quantity: '',
      unitPrice: '',
      tradeCurrency: firstQuote,
      feeAmount: '',
      feeCurrency: firstQuote,
      cashEffect: '',
      appliedExchangeRate: '',
      date: today,
      notes: '',
    },
  })
  const errors = form.formState.errors
  const [instrumentId, relatedId, numerator, denominator, tradeCurrency, feeCurrency, date, destinationId] = useWatch({
    control: form.control,
    name: ['instrumentId', 'relatedInstrumentId', 'numerator', 'denominator', 'tradeCurrency', 'feeCurrency', 'date', 'destinationAccountId'],
  })
  const source = instruments.data?.find((i) => i.id === instrumentId)
  const related = instruments.data?.find((i) => i.id === relatedId)
  const held = positions.find((p) => p.instrumentId === instrumentId)
  const srcSym = held?.instrumentSymbol || symbolOf(source, 'the holding')
  const relSym = symbolOf(related, kind === 'spinoff' ? 'the new instrument' : 'the new holding')
  const cross = tradeCurrency !== c
  const ratioReady = isPositiveDecimal(numerator) && isPositiveDecimal(denominator)

  const toRequest = (v: Values): CorporateActionRequest => {
    const notes = optional(v.notes)
    switch (kind) {
      case 'split':
        return { accountId: account.id, instrumentId: v.instrumentId, numerator: v.numerator, denominator: v.denominator, actionDate: v.date, notes }
      case 'spinoff':
        return { accountId: account.id, sourceInstrumentId: v.instrumentId, newInstrumentId: v.relatedInstrumentId, numerator: v.numerator, denominator: v.denominator, actionDate: v.date, notes }
      case 'merger':
        return {
          accountId: account.id,
          sourceInstrumentId: v.instrumentId,
          destinationInstrumentId: v.relatedInstrumentId,
          numerator: v.numerator,
          denominator: v.denominator,
          actionDate: v.date,
          notes,
        }
      case 'drip': {
        const isCross = v.tradeCurrency !== c
        const feeCcy = v.feeCurrency || v.tradeCurrency
        return {
          accountId: account.id,
          instrumentId: v.instrumentId,
          dividendAmount: moneyDecimal(v.dividendAmount, c),
          quantity: v.quantity,
          unitPrice: v.unitPrice,
          tradeCurrency: v.tradeCurrency,
          feeAmount: v.feeAmount ? moneyDecimal(v.feeAmount, feeCcy) : undefined,
          feeCurrency: v.feeAmount ? feeCcy : undefined,
          cashEffect: isCross && v.cashEffect ? moneyDecimal(v.cashEffect, c) : undefined,
          appliedExchangeRate: isCross ? optional(v.appliedExchangeRate) : undefined,
          activityDate: v.date,
          notes,
        }
      }
      case 'inkind':
        return {
          sourceAccountId: account.id,
          destinationAccountId: v.destinationAccountId,
          instrumentId: v.instrumentId,
          quantity: v.quantity,
          transferDate: v.date,
          feeAmount: v.feeAmount ? moneyDecimal(v.feeAmount, c) : undefined,
          notes,
        }
    }
  }

  const record = useApiMutation({
    mutationFn: (v: Values) => {
      const body = toRequest(v)
      return api.corporateActions.create(ENDPOINT[kind], body, { idempotencyKey: attempt.keyFor(body) })
    },
    toastError: false,
    onSuccess: () => {
      attempt.reset()
      toast.success(`${meta.label} recorded`, { description: 'It appears in the activity feed as one grouped entry you can undo.' })
      onDone()
    },
  })
  const submit = form.handleSubmit((v) => {
    if (record.isPending) return
    onPendingChange(true)
    record.mutate(v, { onSettled: () => onPendingChange(false) })
  })

  const currencyOptions = [...new Set([...enabledCurrencies, c, source?.quoteCurrency].filter((x): x is string => !!x))].sort().map((x) => ({ value: x, label: x }))
  const heldOptions = positions.map((p) => ({ value: p.instrumentId, label: positionLabel(p) }))
  const nothingHeld = kind !== 'drip' && positions.length === 0
  const heldHint = held ? (
    <>
      Holding <Quantity value={held.quantity} /> {held.instrumentSymbol || 'units'} today
    </>
  ) : undefined

  const instrumentSelect = (label: string) =>
    kind === 'drip' ? (
      <SelectField
        label={label}
        {...form.register('instrumentId', {
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
            const next = active.find((i) => i.id === e.target.value)
            if (next) {
              form.setValue('tradeCurrency', next.quoteCurrency)
              form.setValue('feeCurrency', next.quoteCurrency)
            }
          },
        })}
        options={active.map((i) => ({ value: i.id, label: instrumentLabel(i) }))}
        placeholder="Choose an instrument"
        error={errors.instrumentId?.message}
        hint={heldHint}
      />
    ) : (
      <SelectField label={label} {...form.register('instrumentId')} options={heldOptions} placeholder="Choose a holding" error={errors.instrumentId?.message} hint={heldHint} />
    )

  const relatedSelect = (label: string, hint: ReactNode) => (
    <SelectField
      label={label}
      {...form.register('relatedInstrumentId')}
      options={active.filter((i) => i.id !== instrumentId).map((i) => ({ value: i.id, label: instrumentLabel(i) }))}
      placeholder="Choose an instrument"
      error={errors.relatedInstrumentId?.message}
      hint={hint}
    />
  )

  const ratioInputs = (receiveSuffix: string, everySuffix: string) => (
    <div className="grid grid-cols-2 gap-4">
      <Controller
        control={form.control}
        name="numerator"
        render={({ field, fieldState }) => (
          <DecimalInput label="Receive" value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} suffix={receiveSuffix} />
        )}
      />
      <Controller
        control={form.control}
        name="denominator"
        render={({ field, fieldState }) => (
          <DecimalInput label="For every" value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} suffix={everySuffix} />
        )}
      />
    </div>
  )

  const ratioText = ratioReady ? `${numerator} for ${denominator}` : 'the ratio'
  const reverse = kind === 'split' && ratioReady && compareDecimal(numerator, denominator) < 0
  const groupUndo = 'Recorded as one group. Undo removes all of it and replays later history.'

  let fields: ReactNode
  let consequences: ReactNode[]
  switch (kind) {
    case 'split':
      fields = (
        <FormSection title="Split terms">
          {instrumentSelect('Instrument')}
          {ratioInputs('new', 'held')}
          {ratioReady ? (
            <p className="text-sm text-ink" aria-live="polite">
              {reverse ? 'Reverse split: ' : ''}every <span className="num font-medium">{denominator}</span> {srcSym} held become <span className="num font-medium">{numerator}</span>.
            </p>
          ) : null}
        </FormSection>
      )
      consequences = [
        `${srcSym} quantity changes by ${ratioText} on the effective date. Cash doesn't move and nothing counts as income or gain.`,
        'Prices dated before the split no longer value the holding. Add a post-split price so the value stays complete.',
        groupUndo,
      ]
      break
    case 'spinoff':
      fields = (
        <FormSection title="Spin-off terms">
          {instrumentSelect('Original holding')}
          {relatedSelect(
            'New instrument',
            <>
              Not listed?{' '}
              <Link to="/settings/instruments?new=1" className="link">
                Add it in settings
              </Link>
              .
            </>,
          )}
          {ratioInputs(related?.symbol || 'new', srcSym === 'the holding' ? 'held' : srcSym)}
        </FormSection>
      )
      consequences = [
        `A ${relSym} holding is added at ${ratioText} ${srcSym} held. ${srcSym} stays as it is.`,
        `No cash moves and nothing counts as income. Add a ${relSym} price to value the new holding.`,
        groupUndo,
      ]
      break
    case 'merger':
      fields = (
        <FormSection title="Merger terms">
          {instrumentSelect('Holding being acquired')}
          {relatedSelect('Instrument you receive', 'The acquirer’s shares.')}
          {ratioInputs(related?.symbol || 'new', srcSym === 'the holding' ? 'held' : srcSym)}
        </FormSection>
      )
      consequences = [`${srcSym} closes on the effective date and becomes ${relSym} at ${ratioText}.`, `No cash moves. Add a ${relSym} price if it has none.`, groupUndo]
      break
    case 'drip':
      fields = (
        <>
          <FormSection title="Dividend">
            {instrumentSelect('Instrument')}
            <Controller
              control={form.control}
              name="dividendAmount"
              render={({ field, fieldState }) => (
                <AmountField
                  label="Dividend amount"
                  currency={c}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  hint="Recorded as income in the account currency."
                />
              )}
            />
          </FormSection>
          <FormSection title="Units bought">
            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="quantity"
                render={({ field, fieldState }) => (
                  <DecimalInput label="Quantity" value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} suffix={source?.symbol ?? 'units'} />
                )}
              />
              <Controller
                control={form.control}
                name="unitPrice"
                render={({ field, fieldState }) => (
                  <DecimalInput label="Unit price" value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} prefix={tradeCurrency} />
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Trade currency" {...form.register('tradeCurrency')} options={currencyOptions} error={errors.tradeCurrency?.message} />
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
            </div>
            <SelectField label="Fee currency" {...form.register('feeCurrency')} options={currencyOptions} className="sm:w-1/2 sm:pr-2" />
            {cross ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={form.control}
                  name="cashEffect"
                  render={({ field, fieldState }) => (
                    <DecimalInput
                      label="Cash paid"
                      optional
                      decimals={minorExponent(c)}
                      prefix={c}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      error={fieldState.error?.message}
                      hint={`Actual ${c} spent on the units, fees included.`}
                    />
                  )}
                />
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
                      hint="Or the rate the broker applied."
                    />
                  )}
                />
              </div>
            ) : null}
            {cross ? <p className="text-xs text-muted">A cross-currency reinvestment needs the {c} cash paid or the applied rate. Wealthboard never substitutes a later market rate.</p> : null}
          </FormSection>
        </>
      )
      consequences = [
        `The dividend is recorded as income and the units as a buy on the same date. Both are saved together or not at all.`,
        'Cash rises by the dividend and falls by the cost of the units, so only any remainder stays in cash.',
        groupUndo,
      ]
      break
    case 'inkind': {
      const dest = destinations.find((a) => a.id === destinationId)
      fields = (
        <FormSection title="Transfer">
          {instrumentSelect('Instrument')}
          <SelectField
            label="Destination account"
            {...form.register('destinationAccountId')}
            options={destinations.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}${a.institutionName ? ` · ${a.institutionName}` : ''}` }))}
            placeholder={destinations.length ? 'Choose an account' : 'No other position-tracked accounts'}
            error={errors.destinationAccountId?.message}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="quantity"
              render={({ field, fieldState }) => (
                <DecimalInput label="Quantity" value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} suffix={held?.instrumentSymbol || 'units'} />
              )}
            />
            <Controller
              control={form.control}
              name="feeAmount"
              render={({ field, fieldState }) => (
                <AmountField
                  label="Transfer fee"
                  optional
                  currency={c}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  hint={`Charged to this account's cash.`}
                />
              )}
            />
          </div>
        </FormSection>
      )
      consequences = [
        `Units move from ${account.name} to ${dest?.name ?? 'the destination'} with no sale. Neither account records a contribution, withdrawal, or gain.`,
        'Both sides are written together. Undo from either account removes both.',
        groupUndo,
      ]
      break
    }
  }

  return (
    <form id="corporate-action" onSubmit={submit} noValidate className="space-y-6">
      {nothingHeld ? (
        <Notice tone="info" title="Nothing is held yet">
          A {meta.label.toLowerCase()} applies to units you hold. Record an opening position or a buy first.
        </Notice>
      ) : null}
      {fields}
      <FormSection title="When">
        <DateField label="Effective date" max={today} {...form.register('date')} error={errors.date?.message} hint={date && date < today ? 'Backdated: every later event replays.' : undefined} />
        <TextareaField label="Notes" optional rows={2} {...form.register('notes')} error={errors.notes?.message} placeholder="Broker notice or reference" />
      </FormSection>
      <Consequences items={consequences} />
      <WorkflowProblem error={record.error} causes={causesFor(kind, c)} />
    </form>
  )
}
