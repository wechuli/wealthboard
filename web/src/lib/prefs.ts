import { APP_NAME } from '@/config'
import type { DashboardRange } from '@/api/types'
import { DEFAULT_DATE_FORMAT, DEFAULT_TIMEZONE, todayISO, type DateFormat } from './dates'
import { useSettings } from './queries'

export interface Prefs {
  ready: boolean
  appName: string
  displayName: string
  baseCurrency: string
  enabledCurrencies: string[]
  timezone: string
  dateFormat: DateFormat
  defaultRange: DashboardRange
  defaultGoalReturnBps: number
  today: string
}

/** The user's display preferences, with sensible defaults while settings load. */
export function usePrefs(): Prefs {
  const { data } = useSettings()
  const s = data?.settings
  const timezone = s?.timezone ?? DEFAULT_TIMEZONE
  return {
    ready: !!s,
    appName: s?.appName?.trim() || APP_NAME,
    displayName: s?.displayName ?? '',
    baseCurrency: s?.baseCurrency ?? 'KES',
    enabledCurrencies: data?.currencyConfiguration.enabledCurrencies ?? ['KES'],
    timezone,
    dateFormat: (s?.preferredDateFormat as DateFormat | undefined) ?? DEFAULT_DATE_FORMAT,
    defaultRange: (s?.defaultDashboardPeriod as DashboardRange | undefined) ?? '1y',
    defaultGoalReturnBps: s?.defaultGoalReturnBps ?? 800,
    today: todayISO(timezone),
  }
}
