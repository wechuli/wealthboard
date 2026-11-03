import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRightLeft, CheckCircle2, ChevronDown, Clock, Plus, Trash2 } from 'lucide-react'
import { useCallback, useId, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import { api } from '@/api'
import type { AttentionItem } from '@/api/extensions'
import type { ExchangeRate, SettingsRead } from '@/api/types'
import { DateText } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'
import { CURRENCIES, orderCurrencyCodes, type CurrencyInfo } from '@/lib/currency'
import { formatDecimal } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation, useAttention } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { AddRateForm } from './AddRateForm'
import { groupRatePairs, parsePairParam, RATE_CURRENT_DAYS, rateAgeDays, rateDate, type RatePair } from './rates'
import { applyFieldErrors, ProblemNotice, SaveFooter, SettingsPanel, SettingsStack, useSaveSettings, WithSettings } from './settings-kit'

/** The add-rate form is driven by the URL (?add=USD-KES or ?add=new) so fix links deep-link straight into it. */
function useAddRateParam() {
  const [params, setParams] = useSearchParams()
  const value = params.get('add')
  const open = useCallback(
    (base?: string, quote?: string) =>
      setParams(
        (p) => {
          p.set('add', base && quote ? `${base}-${quote}` : 'new')
          return p
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  )
  const close = useCallback(
    () =>
      setParams(
        (p) => {
          p.delete('add')
          return p
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  )
  return { value, open, close }
}

// ---- base and enabled currencies ----------------------------------------------

const currencySchema = z.object({
  baseCurrency: z.string().length(3, 'Choose a base currency'),
  enabled: z.array(z.string()),
})
type CurrencyValues = z.infer<typeof currencySchema>

function CurrencyCheckbox({ info, checked, locked, lockReason, onToggle }: { info: CurrencyInfo; checked: boolean; locked: boolean; lockReason?: string; onToggle(): void }) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 transition-[background-color,border-color] duration-[var(--dur-1)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]',
        checked ? 'border-accent/35 bg-accent-soft/45' : 'border-line bg-surface hover:border-line-strong',
        locked ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={onToggle}
        className="size-4 shrink-0 accent-[var(--accent)]"
        aria-describedby={locked ? `${id}-lock` : undefined}
      />
      <span className="num w-10 shrink-0 text-sm font-semibold tracking-wide text-ink">{info.code}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted">{info.name}</span>
      {locked ? (
        <span id={`${id}-lock`} className="shrink-0 text-xs text-subtle">
          {lockReason}
        </span>
      ) : null}
    </label>
  )
}

function CurrencyGroup({ legend, items, value, locked, onChange }: { legend: string; items: CurrencyInfo[]; value: string[]; locked: Map<string, string>; onChange(next: string[]): void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((c) => {
          const isLocked = locked.has(c.code)
          const checked = isLocked || value.includes(c.code)
          return (
            <CurrencyCheckbox
              key={c.code}
              info={c}
              checked={checked}
              locked={isLocked}
              lockReason={locked.get(c.code)}
              onToggle={() => onChange(checked ? value.filter((v) => v !== c.code) : [...value, c.code])}
            />
          )
        })}
      </div>
    </fieldset>
  )
}

function CurrencyForm({ data }: { data: SettingsRead }) {
  const saved = data.settings.baseCurrency
  const referenced = data.currencyConfiguration.referencedCurrencies
  const form = useForm<CurrencyValues>({
    resolver: zodResolver(currencySchema),
    defaultValues: { baseCurrency: saved, enabled: data.currencyConfiguration.enabledCurrencies },
  })
  const { control, handleSubmit, formState, setError, reset, register } = form
  const base = useWatch({ control, name: 'baseCurrency' })
  const locked = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of referenced) m.set(c, 'In use')
    m.set(base, 'Base')
    return m
  }, [referenced, base])
  const save = useSaveSettings('Currencies saved', (patch) => reset({ baseCurrency: patch.baseCurrency ?? saved, enabled: patch.supportedCurrencies ?? [] }))

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    const supported = orderCurrencyCodes([...v.enabled, ...locked.keys()])
    save.mutate({ baseCurrency: v.baseCurrency, supportedCurrencies: supported }, { onError: (err) => applyFieldErrors(err, setError, ['baseCurrency'], { supportedCurrencies: 'enabled' }) })
  })

  const east = CURRENCIES.filter((c) => c.region === 'east-africa')
  const intl = CURRENCIES.filter((c) => c.region === 'international')

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel
        title="Base and enabled currencies"
        description="Net worth, totals, and reports are shown in your base currency. Each account keeps its own currency too."
        footer={<SaveFooter pending={save.isPending} dirty={formState.isDirty} />}
      >
        <div className="flex flex-col gap-6">
          <ProblemNotice error={save.error} />
          <div className="max-w-md">
            <SelectField
              label="Base currency"
              options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
              hint="Every total converts into this currency using your exchange rates."
              error={formState.errors.baseCurrency?.message}
              {...register('baseCurrency')}
            />
          </div>
          {base !== saved ? (
            <Notice tone="warning" title={`Totals will convert into ${base}`}>
              Accounts held in other currencies need a rate to {base}, or their values show as incomplete. Your existing rates stay in place.
            </Notice>
          ) : null}
          <Controller
            control={control}
            name="enabled"
            render={({ field }) => (
              <div className="flex flex-col gap-6">
                <p className="text-sm text-muted">Enabled currencies appear in account, instrument, and rate forms. Your base currency and currencies in use stay on.</p>
                <CurrencyGroup legend="East Africa" items={east} value={field.value} locked={locked} onChange={field.onChange} />
                <CurrencyGroup legend="International" items={intl} value={field.value} locked={locked} onChange={field.onChange} />
              </div>
            )}
          />
        </div>
      </SettingsPanel>
    </form>
  )
}

// ---- exchange rates ------------------------------------------------------------

function RateText({ rate }: { rate: Pick<ExchangeRate, 'baseCurrency' | 'quoteCurrency' | 'rate'> }) {
  return (
    <span className="num whitespace-nowrap">
      <span className="ccy mr-[0.3em]">1 {rate.baseCurrency}</span>
      <span className="text-subtle">=</span> {formatDecimal(rate.rate, { maxFraction: 10 })}
      <span className="ccy ml-[0.3em]">{rate.quoteCurrency}</span>
    </span>
  )
}

function RateFreshness({ rate, today }: { rate: ExchangeRate; today: string }) {
  const days = rateAgeDays(rate, today)
  if (days <= RATE_CURRENT_DAYS)
    return (
      <Badge tone="positive" icon={<CheckCircle2 size={12} aria-hidden />}>
        Current
      </Badge>
    )
  return (
    <Badge tone="warning" icon={<Clock size={12} aria-hidden />} title="Older than a month. It still counts toward totals; add a newer rate when you can.">
      {days} days old
    </Badge>
  )
}

function RateHistory({ pair, onDelete }: { pair: RatePair; onDelete(rate: ExchangeRate): void }) {
  const online = useOnline()
  const label = `${pair.a}/${pair.b} rate history, newest first`
  return (
    <div className="rounded-md border border-line bg-sunken/40">
      <table className="hidden w-full text-sm md:table">
        <caption className="sr-only">{label}</caption>
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Effective from
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Rate
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Recorded
            </th>
            <th scope="col" className="w-12 px-2 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {pair.history.map((r) => (
            <tr key={r.id} className="border-t border-line first:border-t-0">
              <td className="px-3 py-1.5">
                <DateText value={rateDate(r)} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <RateText rate={r} />
              </td>
              <td className="px-3 py-1.5 text-muted">
                <DateText value={r.createdAt} />
              </td>
              <td className="px-2 py-1 text-right">
                <IconButton size="sm" label={`Delete rate from ${rateDate(r)}`} icon={<Trash2 size={15} aria-hidden />} disabled={!online} onClick={() => onDelete(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden" aria-label={label}>
        {pair.history.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-1 pl-3 pr-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <RateText rate={r} />
              </p>
              <p className="text-xs text-muted">
                From <DateText value={rateDate(r)} />
              </p>
            </div>
            <IconButton label={`Delete rate from ${rateDate(r)}`} icon={<Trash2 size={16} aria-hidden />} disabled={!online} onClick={() => onDelete(r)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function PairRow({ pair, today, onDelete, onAdd }: { pair: RatePair; today: string; onDelete(rate: ExchangeRate): void; onAdd(base: string, quote: string): void }) {
  const [open, setOpen] = useState(false)
  const historyId = useId()
  const { latest } = pair
  const stale = rateAgeDays(latest, today) > RATE_CURRENT_DAYS
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[7.5rem_minmax(0,1fr)_auto_auto]">
        <p className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-ink">
          <span>{pair.a}</span>
          <ArrowRightLeft size={13} aria-hidden className="text-subtle" />
          <span className="sr-only">and</span>
          <span>{pair.b}</span>
        </p>
        <div className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
          <p className="text-base text-ink">
            <RateText rate={latest} />
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Effective <DateText value={rateDate(latest)} /> · {latest.source === 'manual' ? 'entered by you' : latest.source}
          </p>
        </div>
        <div className="col-start-2 row-start-1 justify-self-end md:col-start-auto md:row-start-auto">
          <RateFreshness rate={latest} today={today} />
        </div>
        <div className="col-span-2 row-start-3 flex flex-wrap items-center gap-1 md:col-span-1 md:row-start-auto md:justify-self-end">
          {stale ? (
            <Button size="sm" variant="subtle" icon={<Plus size={14} aria-hidden />} onClick={() => onAdd(latest.baseCurrency, latest.quoteCurrency)}>
              Newer rate
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={historyId} onClick={() => setOpen((v) => !v)} className="gap-1.5">
            History
            <span className="num rounded-full bg-sunken px-1.5 text-xs text-subtle">{pair.history.length}</span>
            <ChevronDown size={15} aria-hidden className={cn('transition-transform duration-[var(--dur-2)]', open && 'rotate-180')} />
          </Button>
        </div>
      </div>
      <div id={historyId} hidden={!open} className="mt-3">
        {open ? <RateHistory pair={pair} onDelete={onDelete} /> : null}
      </div>
    </li>
  )
}

function MissingRateNotices({ items, onAdd }: { items: AttentionItem[]; onAdd(base: string, quote: string): void }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it) => {
        const pair = it.pair
        return (
          <Notice
            key={it.id}
            tone="warning"
            title={it.title}
            action={
              pair ? (
                <Button size="sm" variant="secondary" icon={<Plus size={14} aria-hidden />} onClick={() => onAdd(pair.base, pair.quote)}>
                  Add rate
                </Button>
              ) : null
            }
          >
            {it.detail}
            {it.since ? (
              <>
                {' '}
                Affected from <DateText value={it.since} />.
              </>
            ) : null}
          </Notice>
        )
      })}
    </div>
  )
}

function ExchangeRatesPanel({ data, add }: { data: SettingsRead; add: ReturnType<typeof useAddRateParam> }) {
  const { today } = usePrefs()
  const online = useOnline()
  const [toDelete, setToDelete] = useState<ExchangeRate | null>(null)
  const pairs = useMemo(() => groupRatePairs(data.exchangeRates), [data.exchangeRates])
  const base = data.settings.baseCurrency
  const config = data.currencyConfiguration

  const prefill = parsePairParam(add.value)
  const firstForeign = config.enabledCurrencies.find((c) => c !== base) ?? (base === 'USD' ? 'KES' : 'USD')
  const formBase = prefill?.base ?? firstForeign
  const formQuote = prefill?.quote ?? base
  const offered = useMemo(() => {
    return orderCurrencyCodes([...config.enabledCurrencies, ...config.referencedCurrencies, base, formBase, formQuote])
  }, [config, base, formBase, formQuote])

  const remove = useApiMutation({
    mutationFn: (id: string) => api.exchangeRates.remove(id),
    success: 'Rate deleted',
    toastError: false,
    onSuccess: () => setToDelete(null),
  })

  return (
    <SettingsPanel
      title="Exchange rates"
      description={`Rates you enter convert other currencies into ${base}. Each applies from its date until a newer one. Rates older than a month still count, but are flagged.`}
      action={
        add.value === null ? (
          <Button variant="secondary" icon={<Plus size={16} aria-hidden />} onClick={() => add.open()} disabled={!online} title={!online ? OFFLINE_REASON : undefined}>
            Add rate
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        {add.value !== null ? <AddRateForm key={add.value} initialBase={formBase} initialQuote={formQuote} currencies={offered} today={today} onDone={add.close} onCancel={add.close} /> : null}
        {pairs.length === 0 ? (
          <EmptyState
            compact
            icon={<ArrowRightLeft size={20} aria-hidden />}
            title="No exchange rates yet"
            action={
              add.value === null ? (
                <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => add.open()} disabled={!online}>
                  Add your first rate
                </Button>
              ) : undefined
            }
          >
            You only need rates for currencies other than {base}. Until a rate exists, accounts in that currency show as incomplete, never as zero.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line" aria-label="Currency pairs">
            {pairs.map((p) => (
              <PairRow key={p.key} pair={p} today={today} onDelete={setToDelete} onAdd={add.open} />
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o) {
            setToDelete(null)
            remove.reset()
          }
        }}
        title="Delete this rate?"
        description={toDelete ? `1 ${toDelete.baseCurrency} = ${formatDecimal(toDelete.rate, { maxFraction: 10 })} ${toDelete.quoteCurrency}, effective ${rateDate(toDelete)}.` : undefined}
        confirmLabel="Delete rate"
        pending={remove.isPending}
        confirmDisabled={!online}
        onConfirm={() => {
          if (toDelete && !remove.isPending) remove.mutate(toDelete.id)
        }}
      >
        <p className="text-sm text-muted">Values on those dates will use the next earlier rate. If there isn’t one, they show as incomplete until you add a rate.</p>
        <ProblemNotice error={remove.error} className="mt-3" />
      </ConfirmDialog>
    </SettingsPanel>
  )
}

function CurrencyPage({ data }: { data: SettingsRead }) {
  const add = useAddRateParam()
  const attention = useAttention()
  const missing = (attention.data?.items ?? []).filter((i) => i.kind === 'missing_rate')
  return (
    <SettingsStack>
      <MissingRateNotices items={missing} onAdd={add.open} />
      <ExchangeRatesPanel data={data} add={add} />
      <CurrencyForm data={data} />
    </SettingsStack>
  )
}

export default function CurrencySettings() {
  usePageTitle('Currencies and rates')
  return <WithSettings panels={2}>{(data) => <CurrencyPage data={data} />}</WithSettings>
}
