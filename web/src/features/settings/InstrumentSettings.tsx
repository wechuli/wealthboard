import { zodResolver } from '@hookform/resolvers/zod'
import { Archive, ArchiveRestore, ChevronRight, LineChart, Pencil, Plus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { z } from 'zod'
import { api } from '@/api'
import type { Freshness } from '@/api/extensions'
import type { Instrument, InstrumentMutationRequest, UserSettings } from '@/api/types'
import { FreshnessBadge, UnitPrice } from '@/components/format'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Notice } from '@/components/ui/Notice'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { daysBetween } from '@/lib/dates'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation, useInstruments, useSettings } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { CURRENCIES } from '@/lib/currency'
import { applyFieldErrors, Disclosure, ListSkeleton, ProblemNotice, SettingsPanel } from './settings-kit'

type AssetType = InstrumentMutationRequest['assetType']
type IdType = InstrumentMutationRequest['identifierType']

const ASSET_LABEL: Record<string, string> = { stock: 'Stock', etf: 'ETF', fund: 'Fund' }
const ID_TYPES: { value: IdType; label: string; ariaLabel: string }[] = [
  { value: 'isin', label: 'ISIN', ariaLabel: 'ISIN' },
  { value: 'ticker_exchange', label: 'Ticker + exchange', ariaLabel: 'Ticker and exchange' },
  { value: 'custom', label: 'Custom', ariaLabel: 'Custom identifier' },
]

function staleDays(settings: UserSettings | undefined, assetType: string): number {
  if (!settings) return assetType === 'fund' ? 7 : 5
  return assetType === 'fund' ? settings.positionStaleDaysFund : assetType === 'etf' ? settings.positionStaleDaysEtf : settings.positionStaleDaysStock
}

/** Price freshness from the latest price date and the user's thresholds (a date comparison, not a financial calculation). */
function freshnessOf(i: Instrument, settings: UserSettings | undefined, today: string): Freshness {
  if (!i.latestPrice) return 'missing'
  return daysBetween(i.latestPrice.effectiveDate.slice(0, 10), today) > staleDays(settings, i.assetType) ? 'stale' : 'fresh'
}

// ---- add / edit sheet ----------------------------------------------------------

const schema = z
  .object({
    name: z.string().trim().min(1, 'Name the instrument').max(120, 'Use 120 characters or fewer'),
    symbol: z.string().trim().max(16, 'Use 16 characters or fewer'),
    identifierType: z.enum(['isin', 'ticker_exchange', 'custom']),
    identifier: z.string().trim().max(40, 'Use 40 characters or fewer'),
    exchangeMic: z.string().trim(),
    assetType: z.enum(['stock', 'etf', 'fund']),
    quoteCurrency: z.string().length(3, 'Choose a currency'),
  })
  .superRefine((v, ctx) => {
    if (v.identifierType === 'isin' && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v.identifier.toUpperCase()))
      ctx.addIssue({ code: 'custom', path: ['identifier'], message: 'An ISIN is 12 characters, for example IE00BK5BQT80' })
    if (v.identifierType === 'ticker_exchange') {
      if (!v.symbol) ctx.addIssue({ code: 'custom', path: ['symbol'], message: 'Enter the ticker, for example SCOM' })
      if (!/^[A-Za-z0-9]{4}$/.test(v.exchangeMic)) ctx.addIssue({ code: 'custom', path: ['exchangeMic'], message: 'Use the four-character exchange code, for example XNAI' })
    }
    if (v.identifierType === 'custom' && !v.identifier) ctx.addIssue({ code: 'custom', path: ['identifier'], message: 'Enter an identifier you will recognise' })
  })
type Values = z.infer<typeof schema>

function InstrumentSheet({ open, onOpenChange, instrument, defaultCurrency }: { open: boolean; onOpenChange(o: boolean): void; instrument: Instrument | null; defaultCurrency: string }) {
  const formId = useId()
  const online = useOnline()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      name: instrument?.name ?? '',
      symbol: instrument?.symbol ?? '',
      identifierType: (instrument?.identifierType as IdType | undefined) ?? 'ticker_exchange',
      identifier: instrument?.identifier ?? '',
      exchangeMic: instrument?.exchangeMic ?? '',
      assetType: (instrument?.assetType as AssetType | undefined) ?? 'stock',
      quoteCurrency: instrument?.quoteCurrency ?? defaultCurrency,
    },
  })
  const { register, control, handleSubmit, formState, setError } = form
  const idType = useWatch({ control, name: 'identifierType' })
  const save = useApiMutation({
    mutationFn: (body: InstrumentMutationRequest) => (instrument ? api.instruments.update(instrument.id, body) : api.instruments.create(body).then(() => undefined)),
    success: (_r, body) => (instrument ? `${body.name} saved` : `${body.name} added`),
    toastError: false,
    onSuccess: () => onOpenChange(false),
  })
  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    const body: InstrumentMutationRequest = {
      name: v.name,
      symbol: v.symbol ? v.symbol.toUpperCase() : undefined,
      identifierType: v.identifierType,
      identifier: v.identifier ? (v.identifierType === 'isin' ? v.identifier.toUpperCase() : v.identifier) : undefined,
      exchangeMic: v.exchangeMic ? v.exchangeMic.toUpperCase() : undefined,
      assetType: v.assetType,
      quoteCurrency: v.quoteCurrency,
      externalId: instrument?.externalId ?? undefined,
    }
    save.mutate(body, { onError: (err) => applyFieldErrors(err, setError, ['name', 'symbol', 'identifierType', 'identifier', 'exchangeMic', 'assetType', 'quoteCurrency']) })
  })

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={instrument ? `Edit ${instrument.symbol ?? instrument.name}` : 'New instrument'}
      description="Stocks, ETFs, and funds you hold in position-tracked accounts. You enter their prices; nothing is fetched from the internet."
      footer={
        <>
          {!online ? <p className="mr-auto self-center text-xs text-warning">{OFFLINE_REASON}</p> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!online}>
            {instrument ? 'Save instrument' : 'Add instrument'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ProblemNotice error={save.error} />
        <TextField label="Name" autoComplete="off" placeholder="For example, Safaricom PLC" error={formState.errors.name?.message} {...register('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Asset type"
            options={[
              { value: 'stock', label: 'Stock' },
              { value: 'etf', label: 'ETF' },
              { value: 'fund', label: 'Fund' },
            ]}
            hint="Sets which stale-price threshold applies."
            error={formState.errors.assetType?.message}
            {...register('assetType')}
          />
          <SelectField
            label="Quote currency"
            options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
            hint="The currency its prices are quoted in."
            error={formState.errors.quoteCurrency?.message}
            {...register('quoteCurrency')}
          />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink" aria-hidden>
            Identified by
          </p>
          <Controller control={control} name="identifierType" render={({ field }) => <Segmented<IdType> label="Identified by" value={field.value} onChange={field.onChange} options={ID_TYPES} />} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Symbol"
            optional={idType !== 'ticker_exchange'}
            autoComplete="off"
            className="[&_input]:uppercase"
            placeholder="SCOM"
            error={formState.errors.symbol?.message}
            {...register('symbol')}
          />
          {idType === 'ticker_exchange' ? (
            <TextField
              label="Exchange (MIC)"
              autoComplete="off"
              maxLength={4}
              className="[&_input]:uppercase"
              placeholder="XNAI"
              hint="XNAI is the Nairobi Securities Exchange."
              error={formState.errors.exchangeMic?.message}
              {...register('exchangeMic')}
            />
          ) : (
            <TextField
              label={idType === 'isin' ? 'ISIN' : 'Identifier'}
              autoComplete="off"
              className={idType === 'isin' ? '[&_input]:uppercase' : undefined}
              placeholder={idType === 'isin' ? 'IE00BK5BQT80' : 'Your own reference'}
              error={formState.errors.identifier?.message}
              {...register('identifier')}
            />
          )}
        </div>
      </form>
    </Sheet>
  )
}

// ---- list ----------------------------------------------------------------------

function PriceCell({ i }: { i: Instrument }) {
  if (!i.latestPrice)
    return (
      <Link to={`/instruments/${i.id}?addPrice=1`} className="link text-sm">
        Add a price
      </Link>
    )
  return <UnitPrice value={i.latestPrice.price} currency={i.latestPrice.currency} />
}

function InstrumentList({ instruments }: { instruments: Instrument[] }) {
  const online = useOnline()
  const { today, baseCurrency } = usePrefs()
  const settings = useSettings().data?.settings
  const active = useMemo(() => instruments.filter((i) => !i.archivedAt).sort((a, b) => (a.symbol ?? a.name).localeCompare(b.symbol ?? b.name)), [instruments])
  const archived = useMemo(() => instruments.filter((i) => !!i.archivedAt), [instruments])
  const [archiving, setArchiving] = useState<Instrument | null>(null)

  // The sheet follows the URL: ?new=1 adds an instrument, ?edit=<id> edits one (legacy /instruments/new and
  // /instruments/:id/edit redirect here). Closing removes the parameter.
  const [params, setParams] = useSearchParams()
  const editId = params.get('edit')
  const editTarget = editId ? (instruments.find((i) => i.id === editId) ?? null) : null
  const target = params.get('new') === '1' ? 'new' : editTarget ? editTarget.id : null
  // Remembers the last target so the sheet keeps its content while it animates closed, and remounts (fresh form) on every open.
  const [sheet, setSheet] = useState<{ target: string; seq: number; open: boolean } | null>(target ? { target, seq: 0, open: true } : null)
  if (target && (!sheet || !sheet.open || sheet.target !== target)) setSheet({ target, seq: (sheet?.seq ?? 0) + 1, open: true })
  if (!target && sheet?.open) setSheet({ ...sheet, open: false })
  const sheetInstrument = sheet && sheet.target !== 'new' ? (instruments.find((i) => i.id === sheet.target) ?? null) : null

  const setSheetParam = (next: { new?: boolean; edit?: string } | null) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p)
        out.delete('new')
        out.delete('edit')
        if (next?.new) out.set('new', '1')
        if (next?.edit) out.set('edit', next.edit)
        return out
      },
      { replace: true },
    )

  const archive = useApiMutation({
    mutationFn: (i: Instrument) => api.instruments.setArchived(i.id, true),
    success: (_r, i) => `${i.symbol ?? i.name} archived`,
    toastError: false,
    onSuccess: () => setArchiving(null),
  })
  const restore = useApiMutation({ mutationFn: (i: Instrument) => api.instruments.setArchived(i.id, false), success: (_r, i) => `${i.symbol ?? i.name} restored` })

  const openSheet = (i: Instrument | null) => setSheetParam(i ? { edit: i.id } : { new: true })
  const actions = (i: Instrument) => (
    <div className="flex items-center justify-end gap-0.5">
      <IconButton label={`Edit ${i.name}`} icon={<Pencil size={16} aria-hidden />} onClick={() => openSheet(i)} />
      <IconButton label={`Archive ${i.name}`} icon={<Archive size={16} aria-hidden />} disabled={!online} onClick={() => setArchiving(i)} />
    </div>
  )

  return (
    <SettingsPanel
      title="Instruments"
      description="The securities in your position-tracked accounts, with their latest prices. Open one to see its price history or add a price."
      action={
        <Button variant="secondary" icon={<Plus size={16} aria-hidden />} onClick={() => openSheet(null)} disabled={!online} title={!online ? OFFLINE_REASON : undefined}>
          New instrument
        </Button>
      }
    >
      {editId && !editTarget ? (
        <Notice
          tone="warning"
          role="alert"
          className="mb-4"
          title="That instrument wasn’t found"
          action={
            <Button size="sm" variant="ghost" onClick={() => setSheetParam(null)}>
              Dismiss
            </Button>
          }
        >
          It may have been removed, or the link is incomplete. Choose one from the list below.
        </Notice>
      ) : null}
      {active.length === 0 ? (
        <EmptyState compact icon={<LineChart size={20} aria-hidden />} title="No instruments yet">
          Instruments are created when you record a buy in a position-tracked account, or you can add them here first.
        </EmptyState>
      ) : (
        <>
          <div className="scroll-x hidden md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Instruments and latest prices</caption>
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">
                    Instrument
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Latest price
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Freshness
                  </th>
                  <th scope="col" className="w-24 py-2 pl-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.map((i) => {
                  const f = freshnessOf(i, settings, today)
                  return (
                    <tr key={i.id} className="border-t border-line first:border-t-0">
                      <td className="max-w-0 py-2.5 pr-3">
                        <Link to={`/instruments/${i.id}`} className="group block min-w-0 rounded-sm">
                          <span className="block truncate font-semibold tracking-wide text-ink group-hover:text-accent">{i.symbol ?? '—'}</span>
                          <span className="block truncate text-xs text-muted">{i.name}</span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                        {ASSET_LABEL[i.assetType] ?? i.assetType} · {i.quoteCurrency}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <PriceCell i={i} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <FreshnessBadge freshness={f} asOf={i.latestPrice?.effectiveDate.slice(0, 10)} />
                          {f === 'stale' ? (
                            <Link to={`/instruments/${i.id}?addPrice=1`} className="link text-xs">
                              Update
                            </Link>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-1.5 pl-3">{actions(i)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col divide-y divide-line md:hidden" aria-label="Instruments and latest prices">
            {active.map((i) => {
              const f = freshnessOf(i, settings, today)
              return (
                <li key={i.id} className="py-3 first:pt-0">
                  <div className="flex items-start gap-2">
                    <Link to={`/instruments/${i.id}`} className="min-w-0 flex-1 rounded-sm">
                      <span className="flex items-center gap-1 font-semibold tracking-wide text-ink">
                        {i.symbol ?? i.name}
                        <ChevronRight size={14} aria-hidden className="text-subtle" />
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {i.name} · {ASSET_LABEL[i.assetType] ?? i.assetType}
                      </span>
                    </Link>
                    {actions(i)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                    <PriceCell i={i} />
                    <FreshnessBadge freshness={f} asOf={i.latestPrice?.effectiveDate.slice(0, 10)} />
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Prices older than {settings?.positionStaleDaysStock ?? '—'} days (stocks), {settings?.positionStaleDaysEtf ?? '—'} days (ETFs), or {settings?.positionStaleDaysFund ?? '—'} days (funds) are stale.{' '}
            <Link to="/settings/preferences" className="link">
              Change thresholds
            </Link>
          </p>
        </>
      )}
      {archived.length > 0 ? (
        <Disclosure label="Archived instruments" count={archived.length} className="mt-4">
          <ul className="flex flex-col divide-y divide-line">
            {archived.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-muted">
                  {i.symbol ? <span className="font-medium">{i.symbol} · </span> : null}
                  {i.name}
                </span>
                <Button size="sm" variant="ghost" icon={<ArchiveRestore size={15} aria-hidden />} disabled={!online || restore.isPending} onClick={() => restore.mutate(i)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      <InstrumentSheet
        key={sheet ? `${sheet.target}:${sheet.seq}` : 'none'}
        open={!!target}
        onOpenChange={(o) => {
          if (!o) setSheetParam(null)
        }}
        instrument={sheetInstrument}
        defaultCurrency={baseCurrency}
      />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => {
          if (!o) {
            setArchiving(null)
            archive.reset()
          }
        }}
        title={archiving ? `Archive ${archiving.symbol ?? archiving.name}?` : 'Archive instrument?'}
        description="It disappears from buy and price forms. Its price history and any past trades are kept, and you can restore it later."
        confirmLabel="Archive"
        pending={archive.isPending}
        confirmDisabled={!online}
        onConfirm={() => {
          if (archiving && !archive.isPending) archive.mutate(archiving)
        }}
      >
        <ProblemNotice error={archive.error} />
      </ConfirmDialog>
    </SettingsPanel>
  )
}

export default function InstrumentSettings() {
  usePageTitle('Instruments')
  const { data, error, isPending, refetch } = useInstruments()
  if (isPending) return <ListSkeleton rows={5} />
  if (error || !data)
    return (
      <div className="card">
        <ErrorState error={error} onRetry={() => void refetch()} title="Instruments could not be loaded" />
      </div>
    )
  return <InstrumentList instruments={data} />
}

