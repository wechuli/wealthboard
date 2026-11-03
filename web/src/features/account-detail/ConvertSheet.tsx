/** Convert a value-tracked account into an explicit cash-and-holdings replacement, previewed before it commits. */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Eye, Layers, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { z } from 'zod'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { Account, AccountConversionPreview, AccountConversionRequest, AccountPosition } from '@/api/types'
import { DateText, Money, Quantity, UnitPrice } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Dialog'
import { AmountField, DateField, SelectField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { minorSign } from '@/lib/money'
import { OFFLINE_REASON, isOnline, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiMutation, useInstruments } from '@/lib/queries'
import {
  Consequences,
  DecimalInput,
  FigureList,
  FormSection,
  WorkflowProblem,
  decimalMessage,
  instrumentLabel,
  isNonNegativeDecimal,
  isPositiveDecimal,
  moneyDecimal,
  useAttemptKey,
} from './workflow-kit'

const holdingSchema = z.object({
  instrumentId: z.string().min(1, 'Choose an instrument'),
  quantity: z.string().refine(isPositiveDecimal, decimalMessage.positive),
  price: z.string().refine(isPositiveDecimal, decimalMessage.positive),
  openingCostBasis: z.string().refine((v) => v === '' || isNonNegativeDecimal(v), decimalMessage.nonNegative),
  priceSource: z.string().trim().min(1, 'Say where the price came from, such as statement').max(100, 'Keep it under 100 characters'),
})

type Values = {
  targetName: string
  conversionDate: string
  openingCash: string
  holdings: z.infer<typeof holdingSchema>[]
}

const blankHolding = (): Values['holdings'][number] => ({ instrumentId: '', quantity: '', price: '', openingCostBasis: '', priceSource: 'conversion' })

/** Server messages that belong to one field. */
const FIELD_HINTS: [RegExp, 'targetName' | 'conversionDate' | 'openingCash'][] = [
  [/replacement account name/i, 'targetName'],
  [/conversion date/i, 'conversionDate'],
  [/opening cash/i, 'openingCash'],
]

export function ConvertSheet({ account, open, onOpenChange }: { account: Account; positions: AccountPosition[]; open: boolean; onOpenChange(o: boolean): void }) {
  const { today } = usePrefs()
  const online = useOnline()
  const navigate = useNavigate()
  const instruments = useInstruments()
  const active = (instruments.data ?? []).filter((i) => !i.archivedAt)
  const attempt = useAttemptKey()
  const c = account.currency

  const schema = z
    .object({
      targetName: z.string().trim().min(1, 'Name the new account').max(100, 'Keep the name under 100 characters'),
      conversionDate: z
        .string()
        .min(1, 'Choose the conversion date')
        .refine((d) => d <= today, 'Choose today or an earlier date'),
      openingCash: z.string().refine((v) => v === '' || isNonNegativeDecimal(v), decimalMessage.nonNegative),
      holdings: z.array(holdingSchema).min(1, 'Add at least one holding. Quantities are never inferred from past activity.'),
    })
    .superRefine((v, ctx) => {
      const seen = new Set<string>()
      v.holdings.forEach((h, i) => {
        if (h.instrumentId && seen.has(h.instrumentId)) ctx.addIssue({ code: 'custom', path: ['holdings', i, 'instrumentId'], message: 'This instrument is already listed. Combine the rows.' })
        seen.add(h.instrumentId)
      })
    })

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { targetName: `${account.name} positions`, conversionDate: today, openingCash: '', holdings: [blankHolding()] },
  })
  const rows = useFieldArray({ control: form.control, name: 'holdings' })
  const values = useWatch({ control: form.control }) as Values
  const errors = form.formState.errors

  const toRequest = (v: Values): AccountConversionRequest => ({
    sourceAccountId: account.id,
    targetName: v.targetName.trim(),
    conversionDate: v.conversionDate,
    openingCash: moneyDecimal(v.openingCash || '0', c),
    holdings: v.holdings.map((h) => ({
      instrumentId: h.instrumentId,
      quantity: h.quantity,
      price: h.price,
      openingCostBasis: h.openingCostBasis ? moneyDecimal(h.openingCostBasis, c) : undefined,
      priceSource: h.priceSource.trim(),
    })),
  })
  const safeBody = (v: Values) => {
    try {
      return JSON.stringify(toRequest(v))
    } catch {
      return null
    }
  }

  const [preview, setPreview] = useState<{ result: AccountConversionPreview; body: string; key: string; confirmed: boolean } | null>(null)
  const stale = preview !== null && safeBody(values) !== preview.body
  const differs = preview ? minorSign(preview.result.differenceMinor) !== 0 : false

  const applyFieldProblem = (error: unknown) => {
    if (!ApiProblem.is(error) || error.status !== 422) return
    const match = FIELD_HINTS.find(([re]) => re.test(error.detail))
    if (match) form.setError(match[1], { type: 'server', message: error.detail.charAt(0).toUpperCase() + error.detail.slice(1) })
  }

  const previewMutation = useMutation<{ result: AccountConversionPreview; body: string; key: string }, Error, AccountConversionRequest>({
    mutationFn: async (body) => {
      if (!isOnline()) throw new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: OFFLINE_REASON })
      const key = attempt.keyFor(body)
      const result = await api.conversions.preview(body, { idempotencyKey: key })
      return { result, body: JSON.stringify(body), key }
    },
    onSuccess: (r) => setPreview({ ...r, confirmed: false }),
    onError: applyFieldProblem,
  })

  const execute = useApiMutation({
    mutationFn: ({ body, key }: { body: AccountConversionRequest; key: string }) => api.conversions.execute(body, { idempotencyKey: key }),
    success: (r, { body }) => (r.replayed ? `${body.targetName} was already created` : `${body.targetName} created. ${account.name} is archived with its history.`),
    toastError: false,
    onSuccess: (r) => navigate(`/accounts/${r.targetAccountId}`),
  })

  const runPreview = form.handleSubmit((v) => {
    execute.reset()
    previewMutation.mutate(toRequest(v))
  })

  const runExecute = () => {
    if (!preview || stale) return
    const body: AccountConversionRequest = { ...(JSON.parse(preview.body) as AccountConversionRequest), confirmDifference: differs ? preview.confirmed : undefined }
    execute.mutate({ body, key: preview.key }, { onError: applyFieldProblem })
  }

  const canExecute = !!preview && !stale && (!differs || preview.confirmed) && online

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title="Convert to position tracking"
      description={`Replace ${account.name} with an account that tracks cash and holdings.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="convert-account" icon={<Eye size={16} aria-hidden />} loading={previewMutation.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
            {preview ? 'Preview again' : 'Preview conversion'}
          </Button>
          <Button variant="primary" loading={execute.isPending} disabled={!canExecute} title={!online ? OFFLINE_REASON : undefined} onClick={runExecute}>
            Convert account
          </Button>
        </>
      }
    >
      <form id="convert-account" onSubmit={runPreview} noValidate className="space-y-6">
        <Consequences
          title="How conversion works"
          items={[
            <>{account.name} is archived on the conversion date with its history intact. A new position-tracked account starts that day with the cash and holdings you enter.</>,
            'Linked goals and estate plans move to the new account in the same step.',
            'Quantities are never inferred from past deposits, withdrawals, or valuations. Enter them from a statement.',
            'Preview first. If the new total differs from the current value, you confirm the difference before anything is saved.',
          ]}
        />

        <FormSection title="New account">
          <TextField label="Account name" {...form.register('targetName')} error={errors.targetName?.message} autoComplete="off" />
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField label="Conversion date" max={today} {...form.register('conversionDate')} error={errors.conversionDate?.message} hint="On or after the latest activity in this account." />
            <Controller
              control={form.control}
              name="openingCash"
              render={({ field, fieldState }) => (
                <AmountField
                  label="Opening cash"
                  optional
                  currency={c}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                  hint="Uninvested cash at the broker on that date."
                />
              )}
            />
          </div>
        </FormSection>

        <FormSection title="Opening holdings" description="One row per instrument, from the statement on the conversion date.">
          {instruments.isPending ? null : active.length === 0 ? (
            <Notice
              tone="info"
              title="Add the instruments you hold first"
              action={
                <Link to="/settings/instruments?new=1" className="link text-sm font-medium">
                  Add instrument
                </Link>
              }
            >
              Each holding needs an instrument with a quote currency. Nothing here is saved until you convert.
            </Notice>
          ) : null}
          {errors.holdings?.root?.message || errors.holdings?.message ? (
            <p className="text-xs font-medium text-negative" role="alert">
              {errors.holdings?.root?.message ?? errors.holdings?.message}
            </p>
          ) : null}
          <ol className="space-y-3">
            {rows.fields.map((row, i) => {
              const inst = active.find((x) => x.id === values.holdings?.[i]?.instrumentId)
              const e = errors.holdings?.[i]
              return (
                <li key={row.id} className="rounded-lg border border-line bg-surface p-3.5" aria-label={`Holding ${i + 1}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-ink">Holding {i + 1}</p>
                    <IconButton label={`Remove holding ${i + 1}`} icon={<Trash2 size={16} />} onClick={() => rows.remove(i)} disabled={rows.fields.length === 1} />
                  </div>
                  <div className="space-y-4">
                    <SelectField
                      label="Instrument"
                      {...form.register(`holdings.${i}.instrumentId`)}
                      options={active.map((x) => ({ value: x.id, label: instrumentLabel(x) }))}
                      placeholder="Choose an instrument"
                      error={e?.instrumentId?.message}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Controller
                        control={form.control}
                        name={`holdings.${i}.quantity`}
                        render={({ field, fieldState }) => (
                          <DecimalInput label="Quantity" value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} suffix={inst?.symbol ?? 'units'} />
                        )}
                      />
                      <Controller
                        control={form.control}
                        name={`holdings.${i}.price`}
                        render={({ field, fieldState }) => (
                          <DecimalInput
                            label="Unit price"
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            error={fieldState.error?.message}
                            prefix={inst?.quoteCurrency ?? c}
                            hint="Saved as a price on the conversion date."
                          />
                        )}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Controller
                        control={form.control}
                        name={`holdings.${i}.openingCostBasis`}
                        render={({ field, fieldState }) => (
                          <AmountField
                            label="Opening cost basis"
                            optional
                            currency={c}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            error={fieldState.error?.message}
                            hint="Reference only. Not used in values."
                          />
                        )}
                      />
                      <TextField
                        label="Price source"
                        {...form.register(`holdings.${i}.priceSource`)}
                        error={e?.priceSource?.message}
                        autoComplete="off"
                        hint="For example statement or broker portal."
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          <Button size="sm" icon={<Plus size={15} aria-hidden />} onClick={() => rows.append(blankHolding())}>
            Add holding
          </Button>
        </FormSection>

        {preview ? (
          <section aria-labelledby="convert-preview-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="convert-preview-heading" className="text-sm font-semibold text-ink">
                Preview
              </h3>
              <span className="text-xs text-muted">
                As of <DateText value={preview.result.conversionDate} />
              </span>
            </div>
            {stale ? (
              <Notice tone="info" title="The details changed since this preview">
                Preview again to see the effect of your changes before converting.
              </Notice>
            ) : null}
            <FigureList
              items={[
                {
                  label: `${preview.result.sourceAccountName} today`,
                  hint: 'Current value of the value-tracked account',
                  value: <Money minor={preview.result.sourceBalanceMinor} currency={preview.result.currency} />,
                },
                { label: 'Opening cash', value: <Money minor={preview.result.openingCashMinor} currency={preview.result.currency} /> },
                { label: 'Holdings at these prices', value: <Money minor={preview.result.positionsMinor} currency={preview.result.currency} /> },
                { label: 'New account total', strong: true, value: <Money minor={preview.result.projectedTotalMinor} currency={preview.result.currency} /> },
                {
                  label: 'Difference',
                  hint: differs ? 'New total minus current value' : undefined,
                  value: differs ? <Money minor={preview.result.differenceMinor} currency={preview.result.currency} sign="always" /> : <Badge tone="positive">Matches</Badge>,
                },
              ]}
            />
            {preview.result.holdings.length ? (
              <div className="overflow-hidden rounded-md border border-line">
                <table className="w-full text-sm">
                  <caption className="sr-only">Opening holdings in the new account</caption>
                  <thead>
                    <tr className="bg-sunken/70 text-left text-xs text-muted">
                      <th scope="col" className="px-3 py-2 font-medium">
                        Instrument
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Quantity
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.result.holdings.map((h) => (
                      <tr key={h.instrumentId} className="border-t border-line">
                        <th scope="row" className="max-w-0 px-3 py-2 text-left font-normal">
                          <span className="block truncate text-ink">{h.name}</span>
                          {h.symbol ? <span className="num text-xs text-muted">{h.symbol}</span> : null}
                        </th>
                        <td className="px-3 py-2 text-right">
                          <Quantity value={h.quantity} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <UnitPrice value={h.price} currency={h.quoteCurrency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {differs && !stale ? (
              <Notice tone="warning" title="The new account won't match the current value">
                <p>
                  Net worth changes by <Money minor={preview.result.differenceMinor} currency={preview.result.currency} sign="always" /> on <DateText value={preview.result.conversionDate} />. Check
                  quantities, prices, and cash against your statement. If the difference is real, for example because the old value was out of date, confirm it.
                </p>
                <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2.5 text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                    checked={preview.confirmed}
                    onChange={(e) => setPreview({ ...preview, confirmed: e.target.checked })}
                  />
                  <span className="text-sm font-medium">I've checked the difference and want to convert anyway</span>
                </label>
              </Notice>
            ) : null}
          </section>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Layers size={15} aria-hidden className="shrink-0" />
            Nothing is saved until you preview and then convert.
          </p>
        )}

        <WorkflowProblem error={previewMutation.error} />
        <WorkflowProblem error={execute.error} />
      </form>
    </Sheet>
  )
}
