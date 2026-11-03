import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useMemo, type ReactNode } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Goal, GoalMutationRequest, GoalStatus } from '@/api/types'
import { canonicalIconName, CategoryIcon, ICON_NAMES, ICONS } from '@/components/CategoryIcon'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Dialog'
import { AmountField, DateField, FieldShell, inputClass, sanitizeAmountInput, SelectField, TextareaField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'
import { decimalToMinor, minorToDecimal, PrecisionError } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useAccounts, useApiMutation } from '@/lib/queries'
import { ProblemNotice } from '@/features/settings/settings-kit'
import { bpsToPercentInput } from './goalMeta'

type Frequency = GoalMutationRequest['frequency']

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'custom', label: 'Custom schedule' },
]

function toFrequency(value: string | undefined): Frequency {
  if (value === 'yearly') return 'annually'
  return FREQUENCIES.some((f) => f.value === value) ? (value as Frequency) : 'monthly'
}

const iconLabel = (name: string) => {
  const t = canonicalIconName(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Validates a major-unit amount against the currency's precision without floating point. */
function amountIssue(value: string, currency: string, { allowZero }: { allowZero: boolean }): string | null {
  if (!value.trim()) return allowZero ? null : 'Enter an amount'
  try {
    const minor = BigInt(decimalToMinor(value, currency))
    if (minor < 0n) return 'Enter zero or more'
    if (!allowZero && minor === 0n) return 'Enter an amount greater than zero'
    return null
  } catch (e) {
    return e instanceof PrecisionError ? e.message : 'Enter a number'
  }
}

/** Major-unit decimal string the API expects, normalised through exact minor units ("1,500" → "1500.00"). */
export function toMajorString(value: string, currency: string): string {
  return minorToDecimal(decimalToMinor(value.trim() || '0', currency), currency)
}

const RETURN_RE = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/

const schema = z
  .object({
    name: z.string().trim().min(1, 'Name the goal').max(100, 'Use 100 characters or fewer'),
    description: z.string().trim().max(500, 'Use 500 characters or fewer'),
    icon: z.string().min(1).max(50),
    currency: z.string().length(3, 'Choose a currency'),
    target: z.string(),
    targetDate: z.string().min(1, 'Choose a target date'),
    linkedAccountId: z.string(),
    current: z.string(),
    planned: z.string(),
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annually', 'custom']),
    planStartDate: z.string().min(1, 'Choose when contributions start'),
    planEndDate: z.string(),
    returnPct: z.string().trim().min(1, 'Enter a return, or 0').regex(RETURN_RE, 'Use a percentage from 0 to 100 with up to two decimals'),
    priority: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, 'Use a whole number from 0 to 100')
      .refine((v) => Number(v) <= 100, 'Use a whole number from 0 to 100'),
  })
  .superRefine((v, ctx) => {
    const target = amountIssue(v.target, v.currency, { allowZero: false })
    if (target) ctx.addIssue({ code: 'custom', path: ['target'], message: target })
    if (!v.linkedAccountId) {
      const current = amountIssue(v.current, v.currency, { allowZero: true })
      if (current) ctx.addIssue({ code: 'custom', path: ['current'], message: current })
    }
    const planned = amountIssue(v.planned, v.currency, { allowZero: true })
    if (planned) ctx.addIssue({ code: 'custom', path: ['planned'], message: planned })
    if (v.targetDate && v.planStartDate && v.targetDate <= v.planStartDate)
      ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'Choose a date after the plan starts' })
    if (v.planEndDate && v.planStartDate && v.planEndDate < v.planStartDate)
      ctx.addIssue({ code: 'custom', path: ['planEndDate'], message: 'End the plan on or after its start date' })
  })
type Values = z.infer<typeof schema>

function defaultsFor(goal: Goal, today: string): Values {
  const icon = canonicalIconName(goal.icon || 'Target')
  return {
    name: goal.name,
    description: goal.description ?? '',
    icon,
    currency: goal.currency,
    target: minorToDecimal(goal.targetAmountMinor, goal.currency),
    targetDate: goal.targetDate,
    linkedAccountId: goal.linkedAccount?.id ?? '',
    current: !goal.linkedAccount && goal.currentAmountCurrency === goal.currency ? minorToDecimal(goal.currentAmountMinor, goal.currency) : '',
    planned: goal.plan ? minorToDecimal(goal.plan.plannedContributionMinor, goal.currency) : '',
    frequency: toFrequency(goal.plan?.frequency),
    planStartDate: goal.plan?.startDate ?? today,
    planEndDate: goal.plan?.endDate ?? '',
    returnPct: bpsToPercentInput(goal.assumedAnnualReturnBps),
    priority: String(goal.priority),
  }
}

/** Builds the full update the API expects: every field, monetary values as exact major-unit decimal strings. */
export function buildGoalUpdate(v: Values, status: GoalStatus): GoalMutationRequest {
  const linked = v.linkedAccountId !== ''
  return {
    name: v.name.trim(),
    description: v.description.trim() || null,
    icon: v.icon,
    currency: v.currency,
    targetAmount: toMajorString(v.target, v.currency),
    // A linked account is the source of truth for progress, so no manual amount is sent with it.
    currentAmount: linked ? undefined : toMajorString(v.current, v.currency),
    targetDate: v.targetDate,
    linkedAccountId: linked ? v.linkedAccountId : null,
    status,
    priority: Number(v.priority),
    // The API takes the assumed return as a percent number (0–100); the input is already a validated decimal string.
    assumedAnnualReturn: Number(v.returnPct),
    plannedContribution: toMajorString(v.planned, v.currency),
    frequency: v.frequency,
    planStartDate: v.planStartDate,
    planEndDate: v.planEndDate || undefined,
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

function PercentField({ label, value, onChange, onBlur, error, hint }: { label: string; value: string; onChange(v: string): void; onBlur?(): void; error?: string; hint?: ReactNode }) {
  return (
    <FieldShell label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={value}
            onBlur={onBlur}
            onChange={(e) => {
              const next = sanitizeAmountInput(e.target.value, 2)
              if (next !== null) onChange(next)
            }}
            className={cn(inputClass, 'num pr-20 text-right')}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-subtle">% a year</span>
        </div>
      )}
    </FieldShell>
  )
}

function IconPicker({ value, onChange }: { value: string; onChange(v: string): void }) {
  const name = useId()
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">Icon</legend>
      {value && !ICONS[value] ? (
        <p className="mb-2 text-xs text-muted">
          The current icon (<code className="font-mono">{value}</code>) isn’t in this set. It’s kept unless you choose another.
        </p>
      ) : null}
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
        {ICON_NAMES.map((n) => {
          const selected = value === n
          return (
            <label
              key={n}
              title={iconLabel(n)}
              className={cn(
                'grid aspect-square min-h-11 cursor-pointer place-items-center rounded-md border transition-[background-color,border-color,color] duration-[var(--dur-1)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]',
                selected ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
              )}
            >
              <input type="radio" name={name} value={n} checked={selected} onChange={() => onChange(n)} className="sr-only" aria-label={iconLabel(n)} />
              <CategoryIcon name={n} size={19} />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Edit every saved part of a goal: details, target, how progress is tracked, the contribution plan, and assumptions. */
export function EditGoalSheet({ goal, open, onOpenChange }: { goal: Goal; open: boolean; onOpenChange(open: boolean): void }) {
  const formId = useId()
  const online = useOnline()
  const prefs = usePrefs()
  const accounts = useAccounts('active')
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: defaultsFor(goal, prefs.today) })
  const { register, control, handleSubmit, formState } = form
  const [currency, linkedAccountId] = useWatch({ control, name: ['currency', 'linkedAccountId'] })

  const currencies = useMemo(() => [...new Set([goal.currency, prefs.baseCurrency, ...prefs.enabledCurrencies])], [goal.currency, prefs.baseCurrency, prefs.enabledCurrencies])
  const accountOptions = useMemo(() => {
    const linkable = (accounts.data ?? []).filter((a) => !a.isLiability && !a.archivedAt).map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))
    // Keep the current link selectable even if that account is now archived or no longer listed.
    if (goal.linkedAccount && !linkable.some((o) => o.value === goal.linkedAccount!.id)) linkable.unshift({ value: goal.linkedAccount.id, label: goal.linkedAccount.name })
    return [{ value: '', label: 'An amount I enter myself' }, ...linkable]
  }, [accounts.data, goal.linkedAccount])
  const linkedAccount = (accounts.data ?? []).find((a) => a.id === linkedAccountId)

  const save = useApiMutation<GoalMutationRequest, void>({
    mutationFn: (body) => api.goals.update(goal.id, body),
    success: (_r, body) => `“${body.name}” saved`,
    toastError: false,
    onSuccess: () => onOpenChange(false),
  })

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    save.mutate(buildGoalUpdate(v, goal.status as GoalStatus))
  })

  const amount = (name: 'target' | 'current' | 'planned', label: string, extra: { optional?: boolean; hint?: ReactNode } = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <AmountField label={label} currency={currency} value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} optional={extra.optional} hint={extra.hint} />
      )}
    />
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!save.isPending) onOpenChange(o)
      }}
      width="lg"
      title={`Edit ${goal.name}`}
      description="Changes apply to tracking, projections, and reminders straight away."
      footer={
        <>
          {!online ? <p className="mr-auto self-center text-xs text-warning">{OFFLINE_REASON}</p> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
            Save goal
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <ProblemNotice error={save.error} />

        <Section title="Details">
          <TextField label="Name" autoComplete="off" error={formState.errors.name?.message} {...register('name')} />
          <TextareaField label="Description" optional rows={2} error={formState.errors.description?.message} {...register('description')} />
          <Controller control={control} name="icon" render={({ field }) => <IconPicker value={field.value} onChange={field.onChange} />} />
        </Section>

        <Section title="Target">
          <div className="grid gap-5 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <SelectField
              label="Currency"
              options={currencies.map((c) => ({ value: c, label: c }))}
              error={formState.errors.currency?.message}
              {...register('currency', { onChange: () => void form.trigger(['target', 'current', 'planned']) })}
            />
            {amount('target', 'Target amount')}
          </div>
          {currency !== goal.currency ? (
            <Notice tone="info" title={`Amounts are now in ${currency}`}>
              Check the target, saved amount, and contribution: they’re read as {currency}, not converted from {goal.currency}.
            </Notice>
          ) : null}
          <DateField label="Target date" error={formState.errors.targetDate?.message} {...register('targetDate')} />
        </Section>

        <Section title="Progress">
          <SelectField
            label="Track progress with"
            options={accountOptions}
            hint={
              linkedAccountId
                ? `The account’s value is the source of truth${linkedAccount && linkedAccount.currency !== currency ? `, converted from ${linkedAccount.currency} to ${currency} with your exchange rates` : ''}. It’s never counted twice as contributions.`
                : 'Enter what you have saved so far and update it as you go.'
            }
            {...register('linkedAccountId')}
          />
          {!linkedAccountId ? amount('current', 'Saved so far', { optional: true, hint: 'Leave empty for nothing saved yet.' }) : null}
        </Section>

        <Section title="Contribution plan">
          <div className="grid gap-5 sm:grid-cols-2">
            {amount('planned', 'Planned contribution', { hint: 'Use 0 if you aren’t contributing regularly.' })}
            <SelectField label="How often" options={FREQUENCIES} error={formState.errors.frequency?.message} {...register('frequency')} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <DateField label="Plan starts" error={formState.errors.planStartDate?.message} {...register('planStartDate')} />
            <DateField label="Plan ends" optional hint="Leave empty to contribute until the target date." error={formState.errors.planEndDate?.message} {...register('planEndDate')} />
          </div>
        </Section>

        <Section title="Assumptions">
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              control={control}
              name="returnPct"
              render={({ field, fieldState }) => (
                <PercentField label="Assumed annual return" value={field.value} onChange={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} hint="Projections compound monthly. No fees, taxes, or inflation." />
              )}
            />
            <TextField label="Priority" inputMode="numeric" autoComplete="off" hint="0 to 100. Lower numbers are listed first." error={formState.errors.priority?.message} {...register('priority')} />
          </div>
        </Section>
      </form>
    </Sheet>
  )
}
