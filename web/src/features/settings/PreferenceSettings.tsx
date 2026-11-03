import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Monitor, Moon, Sun } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import type { SettingsMutationRequest, SettingsRead } from '@/api/types'
import { ChoiceCards, SelectField, TextField } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { DATE_FORMATS, formatDate, TIMEZONES, type DateFormat } from '@/lib/dates'
import { formatBps, percentToBps } from '@/lib/money'
import { usePrefs } from '@/lib/prefs'
import { useTheme } from '@/lib/theme-context'
import type { ThemePreference } from '@/lib/theme'
import { usePageTitle } from '@/lib/usePageTitle'
import { applyFieldErrors, ProblemNotice, SaveFooter, SettingsPanel, SettingsStack, useSaveSettings, wholeNumberInRange, WithSettings } from './settings-kit'

type Period = SettingsMutationRequest['defaultDashboardPeriod']
const PERIODS: { value: Period; label: string; ariaLabel: string }[] = [
  { value: '1m', label: '1M', ariaLabel: 'One month' },
  { value: '3m', label: '3M', ariaLabel: 'Three months' },
  { value: '6m', label: '6M', ariaLabel: 'Six months' },
  { value: '1y', label: '1Y', ariaLabel: 'One year' },
  { value: 'all', label: 'All', ariaLabel: 'All time' },
]

/** 825 → "8.25" (exact, string-based). */
function bpsToPercentInput(bps: number): string {
  const negative = bps < 0
  const abs = Math.abs(Math.trunc(bps)).toString().padStart(3, '0')
  const frac = abs.slice(-2).replace(/0+$/, '')
  return `${negative ? '-' : ''}${abs.slice(0, -2)}${frac ? `.${frac}` : ''}`
}

function safeBps(input: string): number | null {
  try {
    return percentToBps(input)
  } catch {
    return null
  }
}

// ---- regional ------------------------------------------------------------------

const regionalSchema = z.object({
  timezone: z.string().min(1, 'Choose a timezone'),
  preferredDateFormat: z.enum(DATE_FORMATS as unknown as [DateFormat, ...DateFormat[]]),
})
type RegionalValues = z.infer<typeof regionalSchema>

function RegionalForm({ data }: { data: SettingsRead }) {
  const { today } = usePrefs()
  const form = useForm<RegionalValues>({
    resolver: zodResolver(regionalSchema),
    defaultValues: { timezone: data.settings.timezone, preferredDateFormat: data.settings.preferredDateFormat as DateFormat },
  })
  const { register, control, handleSubmit, formState, setError, reset } = form
  const timezone = useWatch({ control, name: 'timezone' })
  const save = useSaveSettings('Date and time saved', (p) => reset({ timezone: p.timezone ?? data.settings.timezone, preferredDateFormat: (p.preferredDateFormat ?? data.settings.preferredDateFormat) as DateFormat }))
  const zones = TIMEZONES.includes(data.settings.timezone) ? TIMEZONES : [data.settings.timezone, ...TIMEZONES]

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    save.mutate(v, { onError: (err) => applyFieldErrors(err, setError, ['timezone', 'preferredDateFormat']) })
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel title="Date and time" description="Dates across the app use your timezone and format. Today is worked out in your timezone too." footer={<SaveFooter pending={save.isPending} dirty={formState.isDirty} />}>
        <div className="flex flex-col gap-6">
          <ProblemNotice error={save.error} />
          <div className="max-w-md">
            <SelectField
              label="Timezone"
              options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
              error={formState.errors.timezone?.message}
              hint={timezone === 'Africa/Nairobi' ? 'East Africa Time (UTC+3).' : undefined}
              {...register('timezone')}
            />
          </div>
          <Controller
            control={control}
            name="preferredDateFormat"
            render={({ field }) => (
              <ChoiceCards<DateFormat>
                name="preferredDateFormat"
                legend="Date format"
                value={field.value}
                onChange={field.onChange}
                columns={2}
                options={DATE_FORMATS.map((f) => ({
                  value: f,
                  title: <span className="num">{formatDate(today, f, timezone)}</span>,
                  description: <span className="font-mono text-[11px] tracking-wide">{f}</span>,
                }))}
              />
            )}
          />
        </div>
      </SettingsPanel>
    </form>
  )
}

// ---- appearance (local, not a server setting) ----------------------------------

function AppearancePanel() {
  const theme = useTheme()
  return (
    <SettingsPanel title="Appearance" description="Applies immediately and is remembered on this device only, so each device can have its own look.">
      <ChoiceCards<ThemePreference>
        name="appearance"
        legend="Theme"
        value={theme.preference}
        onChange={theme.setPreference}
        columns={3}
        options={[
          { value: 'system', title: 'System', description: 'Follow this device', icon: <Monitor size={18} aria-hidden /> },
          { value: 'light', title: 'Paper', description: 'Light, warm paper', icon: <Sun size={18} aria-hidden /> },
          { value: 'dark', title: 'Night ledger', description: 'Dark, low glare', icon: <Moon size={18} aria-hidden /> },
        ]}
      />
    </SettingsPanel>
  )
}

// ---- home and goals ------------------------------------------------------------

const homeSchema = z.object({
  defaultDashboardPeriod: z.enum(['1m', '3m', '6m', '1y', 'all']),
  goalReturn: z
    .string()
    .trim()
    .min(1, 'Enter a percentage, for example 8')
    .refine((v) => safeBps(v) !== null, 'Use a number with up to two decimal places, for example 8.25')
    .refine((v) => {
      const b = safeBps(v)
      return b === null || (b >= 0 && b <= 3000)
    }, 'Use a return between 0% and 30%'),
})
type HomeValues = z.infer<typeof homeSchema>

function HomeGoalsForm({ data }: { data: SettingsRead }) {
  const s = data.settings
  const form = useForm<HomeValues>({
    resolver: zodResolver(homeSchema),
    mode: 'onTouched',
    defaultValues: { defaultDashboardPeriod: s.defaultDashboardPeriod as Period, goalReturn: bpsToPercentInput(s.defaultGoalReturnBps) },
  })
  const { register, control, handleSubmit, formState, setError, reset } = form
  const goalReturn = useWatch({ control, name: 'goalReturn' })
  const bps = safeBps(goalReturn)
  const save = useSaveSettings('Home and goal defaults saved', (p) =>
    reset({ defaultDashboardPeriod: (p.defaultDashboardPeriod ?? s.defaultDashboardPeriod) as Period, goalReturn: bpsToPercentInput(p.defaultGoalReturnBps ?? s.defaultGoalReturnBps) }),
  )

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    const b = safeBps(v.goalReturn)
    if (b === null) return
    save.mutate({ defaultDashboardPeriod: v.defaultDashboardPeriod, defaultGoalReturnBps: b }, { onError: (err) => applyFieldErrors(err, setError, ['defaultDashboardPeriod', 'goalReturn'], { defaultGoalReturnBps: 'goalReturn' }) })
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel title="Home and goals" description="Starting points. You can change the period on Home at any time, and each goal keeps its own return." footer={<SaveFooter pending={save.isPending} dirty={formState.isDirty} />}>
        <div className="flex flex-col gap-6">
          <ProblemNotice error={save.error} />
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink" aria-hidden>
              Default period on Home
            </p>
            <Controller
              control={control}
              name="defaultDashboardPeriod"
              render={({ field }) => <Segmented<Period> label="Default period on Home" value={field.value} onChange={field.onChange} options={PERIODS} />}
            />
            <p className="mt-1.5 text-xs text-muted">Used for the net-worth chart and period changes when you open Home.</p>
          </div>
          <div className="max-w-56">
            <TextField
              label="Default goal return"
              inputMode="decimal"
              autoComplete="off"
              error={formState.errors.goalReturn?.message}
              hint={bps !== null && bps >= 0 && bps <= 3000 ? `Assumed annual return for new goals: ${formatBps(bps)} a year.` : 'Assumed annual return for new goals.'}
              {...register('goalReturn')}
            />
          </div>
        </div>
      </SettingsPanel>
    </form>
  )
}

// ---- price freshness -----------------------------------------------------------

const days = (label: string) => z.string().trim().refine((v) => wholeNumberInRange(v, 1, 365), `${label}: use a whole number of days from 1 to 365`)
const freshSchema = z.object({ stock: days('Stocks'), etf: days('ETFs'), fund: days('Funds') })
type FreshValues = z.infer<typeof freshSchema>

function FreshnessForm({ data }: { data: SettingsRead }) {
  const s = data.settings
  const form = useForm<FreshValues>({
    resolver: zodResolver(freshSchema),
    mode: 'onTouched',
    defaultValues: { stock: String(s.positionStaleDaysStock), etf: String(s.positionStaleDaysEtf), fund: String(s.positionStaleDaysFund) },
  })
  const { register, handleSubmit, formState, setError, reset } = form
  const save = useSaveSettings('Price freshness saved', (p) =>
    reset({ stock: String(p.positionStaleDaysStock ?? s.positionStaleDaysStock), etf: String(p.positionStaleDaysEtf ?? s.positionStaleDaysEtf), fund: String(p.positionStaleDaysFund ?? s.positionStaleDaysFund) }),
  )

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    save.mutate(
      { positionStaleDaysStock: Number(v.stock), positionStaleDaysEtf: Number(v.etf), positionStaleDaysFund: Number(v.fund) },
      { onError: (err) => applyFieldErrors(err, setError, ['stock', 'etf', 'fund'], { positionStaleDaysStock: 'stock', positionStaleDaysEtf: 'etf', positionStaleDaysFund: 'fund' }) },
    )
  })

  const field = (name: keyof FreshValues, label: string) => (
    <div className="min-w-0">
      <TextField label={label} inputMode="numeric" autoComplete="off" error={formState.errors[name]?.message} {...register(name)} />
    </div>
  )

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel
        title="Price freshness"
        description="A unit price older than this many days is marked stale. Stale prices still count toward your totals; the badge reminds you to update them."
        footer={<SaveFooter pending={save.isPending} dirty={formState.isDirty} />}
      >
        <div className="flex flex-col gap-5">
          <ProblemNotice error={save.error} />
          <div className="grid gap-4 sm:grid-cols-3">
            {field('stock', 'Stocks (days)')}
            {field('etf', 'ETFs (days)')}
            {field('fund', 'Funds (days)')}
          </div>
        </div>
      </SettingsPanel>
    </form>
  )
}

export default function PreferenceSettings() {
  usePageTitle('Preferences')
  return (
    <WithSettings panels={3}>
      {(data) => (
        <SettingsStack>
          <RegionalForm data={data} />
          <AppearancePanel />
          <HomeGoalsForm data={data} />
          <FreshnessForm data={data} />
          <p className="px-1 text-sm text-muted">
            Looking for the session timeout?{' '}
            <Link to="/settings/security" className="link inline-flex items-center gap-1">
              It’s under Security <ArrowRight size={14} aria-hidden />
            </Link>
          </p>
        </SettingsStack>
      )}
    </WithSettings>
  )
}
