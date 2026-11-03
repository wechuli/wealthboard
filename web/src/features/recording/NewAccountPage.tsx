import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, Check, CandlestickChart, Plus, Scale, Trash2 } from 'lucide-react'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { Category, TrackingMode } from '@/api/types'
import { Button, buttonClass, IconButton } from '@/components/ui/Button'
import { AmountField, ChoiceCards, DateField, SelectField, SwitchField, TextareaField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { CategoryIcon } from '@/components/CategoryIcon'
import { Money, Quantity, UnitPrice } from '@/components/format'
import { cn } from '@/lib/cn'
import { currencyName } from '@/lib/currency'
import { decimalToMinor, PrecisionError } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { newIdempotencyKey, useApiMutation, useCategories, useInstitutions, useInstruments } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { DecimalField } from './shared'

const STEPS = ['Tracking', 'Details', 'Opening', 'Review'] as const

interface Holding {
  key: string
  instrumentId: string
  quantity: string
  price: string
}

interface Draft {
  mode: TrackingMode
  categoryId: string
  name: string
  institutionId: string
  currency: string
  openedAt: string
  reference: string
  notes: string
  included: boolean
  opening: string
  holdings: Holding[]
}

function amountError(value: string, currency: string, allowEmpty = false): string | undefined {
  if (!value.trim()) return allowEmpty ? undefined : 'Enter an amount, or 0'
  try {
    if (BigInt(decimalToMinor(value, currency)) < 0n) return 'Enter zero or more'
  } catch (e) {
    return e instanceof PrecisionError ? e.message : 'Enter a number'
  }
  return undefined
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={i === step ? 'step' : undefined}>
          <span
            className={cn(
              'num grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
              i < step ? 'bg-accent text-on-accent' : i === step ? 'bg-accent-soft text-accent ring-1 ring-accent' : 'bg-sunken text-subtle',
            )}
          >
            {i < step ? <Check size={14} aria-hidden /> : i + 1}
          </span>
          <span className={cn('truncate text-sm', i === step ? 'font-semibold text-ink' : 'hidden text-muted sm:inline')}>{label}</span>
          {i < STEPS.length - 1 ? <span aria-hidden className="h-px flex-1 bg-line" /> : null}
        </li>
      ))}
    </ol>
  )
}

function CategoryGrid({ categories, value, onChange, error }: { categories: Category[]; value: string; onChange(id: string): void; error?: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">Category</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categories.map((c) => (
          <label
            key={c.id}
            className={cn(
              'flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]',
              value === c.id ? 'border-accent bg-accent-soft/60 font-semibold text-ink' : 'border-line text-ink hover:border-line-strong',
            )}
          >
            <input type="radio" name="category" value={c.id} checked={value === c.id} onChange={() => onChange(c.id)} className="sr-only" />
            <CategoryIcon name={c.icon} size={17} className={value === c.id ? 'text-accent' : 'text-muted'} />
            <span className="min-w-0 truncate">{c.name}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-negative" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

/** New-account wizard: tracking mode first, then category, institution, currency, and opening value or holdings. */
export default function NewAccountPage() {
  usePageTitle('Add an account')
  const navigate = useNavigate()
  const online = useOnline()
  const prefs = usePrefs()
  const categories = useCategories()
  const institutions = useInstitutions()
  const instruments = useInstruments()
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState(false)
  const [draft, setDraft] = useState<Draft>({
    mode: 'balance',
    categoryId: '',
    name: '',
    institutionId: '',
    currency: prefs.baseCurrency,
    openedAt: prefs.today,
    reference: '',
    notes: '',
    included: true,
    opening: '',
    holdings: [],
  })
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const usable = useMemo(
    () => (categories.data ?? []).filter((c) => !c.isArchived && (draft.mode === 'balance' || (c.assetOrLiability === 'asset' && (c.isInvestible || c.name === 'Other Asset')))),
    [categories.data, draft.mode],
  )
  const category = usable.find((c) => c.id === draft.categoryId)
  const isLiability = category?.assetOrLiability === 'liability'
  const currencies = [...new Set([prefs.baseCurrency, ...prefs.enabledCurrencies])]
  const instrumentList = (instruments.data ?? []).filter((i) => !i.archivedAt)

  const errors = {
    categoryId: !draft.categoryId ? 'Choose a category' : undefined,
    name: !draft.name.trim() ? 'Give the account a name' : undefined,
    openedAt: !draft.openedAt ? 'Choose a date' : draft.openedAt > prefs.today ? 'Choose today or an earlier date' : undefined,
    opening: amountError(draft.opening, draft.currency, draft.mode === 'positions'),
    holdings: draft.holdings.some((h) => !h.instrumentId || !/[1-9]/.test(h.quantity) || !/[1-9]/.test(h.price)) ? 'Complete or remove each holding' : undefined,
  }
  const stepValid = [true, !errors.categoryId && !errors.name, !errors.opening && !errors.openedAt && !errors.holdings, true][step]

  const create = useApiMutation({
    mutationFn: async (key: string) => {
      const { id } = await api.accounts.create({
        idempotencyKey: key,
        name: draft.name.trim(),
        categoryId: draft.categoryId,
        institutionId: draft.institutionId || null,
        currency: draft.currency,
        trackingMode: draft.mode,
        openingValueMinor: draft.opening ? decimalToMinor(draft.opening, draft.currency) : '0',
        openedAt: draft.openedAt,
        accountReference: draft.reference.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        isIncludedInNetWorth: draft.included,
      })
      for (const h of draft.holdings) {
        const inst = instrumentList.find((i) => i.id === h.instrumentId)
        await api.positionEvents.create({
          idempotencyKey: newIdempotencyKey(),
          accountId: id,
          instrumentId: h.instrumentId,
          type: 'opening_position',
          quantity: h.quantity,
          unitPrice: h.price,
          tradeCurrency: inst?.quoteCurrency,
          tradeDate: draft.openedAt,
          description: 'Opening holding',
        })
      }
      return id
    },
    success: () => `${draft.name.trim()} added`,
    toastError: false,
    onSuccess: (id) => navigate(`/accounts/${id}`, { replace: true }),
  })

  const next = () => {
    setTouched(true)
    if (!stepValid) return
    setTouched(false)
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  const loading = categories.isPending || institutions.isPending
  const loadError = categories.error ?? institutions.error

  return (
    <div className="page max-w-3xl">
      <PageHeader
        back={
          <Link to="/accounts" className="inline-flex min-h-9 items-center gap-1.5 text-sm text-muted hover:text-ink">
            <ArrowLeft size={16} aria-hidden /> Accounts
          </Link>
        }
        title="Add an account"
        description="An account is anything you own or owe: a fund, a brokerage, land, a vehicle, or a loan."
      />
      {loading ? (
        <Skeleton className="h-96" label="Loading" />
      ) : loadError ? (
        <ErrorState error={loadError} onRetry={() => void categories.refetch()} />
      ) : (
        <div className="card p-5 md:p-7">
          <Stepper step={step} />
          {step === 0 ? (
            <div className="flex flex-col gap-5">
              <ChoiceCards<TrackingMode>
                name="mode"
                legend="How should Wealthboard track it?"
                value={draft.mode}
                onChange={(m) => setDraft((d) => ({ ...d, mode: m, categoryId: '', holdings: [] }))}
                options={[
                  {
                    value: 'balance',
                    icon: <Scale size={20} aria-hidden />,
                    title: 'Value-tracked',
                    description: 'One running value you keep current with deposits, withdrawals, interest, and valuations. For cash, savings, money market and bond funds, land, vehicles, businesses, and loans.',
                  },
                  {
                    value: 'positions',
                    icon: <CandlestickChart size={20} aria-hidden />,
                    title: 'Position-tracked',
                    description: 'An investment account with a cash balance and holdings. Value is cash plus units × the latest price. For brokerages and share accounts.',
                  },
                ]}
              />
              <p className="text-sm text-muted">
                Not sure? Choose value-tracked. You can convert a value-tracked investment to positions later.
              </p>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-5">
              <CategoryGrid categories={usable} value={draft.categoryId} onChange={(id) => set('categoryId', id)} error={touched ? errors.categoryId : undefined} />
              <TextField label="Account name" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={draft.mode === 'positions' ? 'For example: NSE share account' : 'For example: Sacco savings'} error={touched ? errors.name : undefined} />
              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Institution"
                  optional
                  value={draft.institutionId}
                  onChange={(e) => set('institutionId', e.target.value)}
                  options={[{ value: '', label: 'None' }, ...(institutions.data ?? []).filter((i) => !i.archivedAt).map((i) => ({ value: i.id, label: i.name }))]}
                  hint={<Link to="/settings/institutions" className="link">Manage institutions</Link>}
                />
                <SelectField
                  label="Currency"
                  value={draft.currency}
                  onChange={(e) => set('currency', e.target.value)}
                  options={currencies.map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` }))}
                  hint={draft.currency !== prefs.baseCurrency ? `Totals convert to ${prefs.baseCurrency} using your exchange rates.` : 'Your base currency.'}
                />
              </div>
              <TextField label="Account number or reference" optional value={draft.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Last four digits are enough" />
              <SwitchField label="Include in net worth" description="Turn off for accounts you track but don't count, such as money held for someone else." checked={draft.included} onCheckedChange={(v) => set('included', v)} />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-5">
              <DateField label="Tracking starts" max={prefs.today} value={draft.openedAt} onChange={(e) => set('openedAt', e.target.value)} error={touched ? errors.openedAt : undefined} hint="The date of the opening value below." />
              <AmountField
                label={draft.mode === 'positions' ? 'Opening cash' : isLiability ? 'Amount owed today' : 'Value today'}
                optional={draft.mode === 'positions'}
                currency={draft.currency}
                value={draft.opening}
                onChange={(v) => set('opening', v)}
                error={touched ? errors.opening : undefined}
                hint={draft.mode === 'positions' ? 'Uninvested cash in the account.' : isLiability ? 'The outstanding balance. It reduces your net worth.' : 'Counts as your opening contribution.'}
              />
              {draft.mode === 'positions' ? (
                <section aria-label="Opening holdings" className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-ink">Opening holdings</h2>
                    <Button size="sm" icon={<Plus size={15} aria-hidden />} onClick={() => set('holdings', [...draft.holdings, { key: crypto.randomUUID(), instrumentId: instrumentList[0]?.id ?? '', quantity: '', price: '' }])} disabled={instrumentList.length === 0}>
                      Add holding
                    </Button>
                  </div>
                  {instrumentList.length === 0 ? (
                    <Notice tone="info" title="No instruments yet">
                      Add the shares or funds you hold in <Link to="/settings/instruments" className="link">Settings → Instruments</Link>, or start with cash only and record buys later.
                    </Notice>
                  ) : draft.holdings.length === 0 ? (
                    <p className="rounded-md border border-dashed border-line px-4 py-5 text-center text-sm text-muted">Starting with cash only. Add what you already hold, or record buys later.</p>
                  ) : (
                    draft.holdings.map((h, i) => {
                      const inst = instrumentList.find((x) => x.id === h.instrumentId)
                      const update = (patch: Partial<Holding>) => set('holdings', draft.holdings.map((x) => (x.key === h.key ? { ...x, ...patch } : x)))
                      return (
                        <div key={h.key} className="grid items-end gap-3 rounded-md border border-line p-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                          <SelectField label={`Instrument ${i + 1}`} value={h.instrumentId} onChange={(e) => update({ instrumentId: e.target.value })} options={instrumentList.map((x) => ({ value: x.id, label: `${x.symbol ?? ''} ${x.name}`.trim() }))} />
                          <DecimalField label="Quantity" value={h.quantity} onChange={(v) => update({ quantity: v })} suffix={inst?.symbol ?? 'units'} />
                          <AmountField label="Unit price" currency={inst?.quoteCurrency ?? draft.currency} decimals={6} value={h.price} onChange={(v) => update({ price: v })} />
                          <IconButton label={`Remove instrument ${i + 1}`} icon={<Trash2 size={17} aria-hidden />} onClick={() => set('holdings', draft.holdings.filter((x) => x.key !== h.key))} />
                        </div>
                      )
                    })
                  )}
                  {touched && errors.holdings ? (
                    <p className="text-xs font-medium text-negative" role="alert">
                      {errors.holdings}
                    </p>
                  ) : null}
                </section>
              ) : null}
              <TextareaField label="Notes" optional rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-5">
              <dl className="divide-y divide-line rounded-md border border-line">
                {[
                  ['Tracking', draft.mode === 'positions' ? 'Position-tracked (cash + holdings)' : 'Value-tracked (one running value)'],
                  ['Category', category ? <span className="inline-flex items-center gap-2"><CategoryIcon name={category.icon} size={16} className="text-muted" />{category.name}{isLiability ? ' · reduces net worth' : ''}</span> : '—'],
                  ['Name', draft.name],
                  ['Institution', institutions.data?.find((i) => i.id === draft.institutionId)?.name ?? 'None'],
                  ['Currency', `${draft.currency} · ${currencyName(draft.currency)}`],
                  [draft.mode === 'positions' ? 'Opening cash' : isLiability ? 'Amount owed' : 'Opening value', <Money key="o" minor={draft.opening ? decimalToMinor(draft.opening, draft.currency) : '0'} currency={draft.currency} />],
                  ...draft.holdings.map((h, i) => {
                    const inst = instrumentList.find((x) => x.id === h.instrumentId)
                    return [
                      `Holding ${i + 1}`,
                      <span key={h.key}>
                        <Quantity value={h.quantity} /> {inst?.symbol ?? inst?.name} @ <UnitPrice value={h.price} currency={inst?.quoteCurrency ?? draft.currency} />
                      </span>,
                    ] as const
                  }),
                  ['Counts towards net worth', draft.included ? 'Yes' : 'No'],
                ].map(([k, v]) => (
                  <div key={String(k)} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
                    <dt className="text-sm text-muted">{k}</dt>
                    <dd className="text-sm font-medium text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              {ApiProblem.is(create.error) ? (
                <Notice tone="negative" title={create.error.title} role="alert">
                  {create.error.detail}
                </Notice>
              ) : null}
              {!online ? (
                <Notice tone="warning" title="You're offline">
                  {OFFLINE_REASON}
                </Notice>
              ) : null}
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            {step > 0 ? (
              <Button variant="ghost" icon={<ArrowLeft size={16} aria-hidden />} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : (
              <Link to="/accounts" className={buttonClass({ variant: 'ghost' })}>
                Cancel
              </Link>
            )}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" loading={create.isPending} disabled={!online} onClick={() => !create.isPending && create.mutate(newIdempotencyKey())}>
                Create account
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
