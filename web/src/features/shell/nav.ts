import { ArrowLeftRight, BarChart3, Home, Landmark, Settings, Target, Wallet, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Second key of the "G then …" shortcut. */
  key?: string
  end?: boolean
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, key: 'h', end: true },
  { to: '/accounts', label: 'Accounts', icon: Wallet, key: 'c' },
  { to: '/activity', label: 'Activity', icon: ArrowLeftRight, key: 't' },
  { to: '/goals', label: 'Goals', icon: Target, key: 'g' },
  { to: '/insights', label: 'Insights', icon: BarChart3, key: 'i' },
]

export const PLANNING_NAV: NavItem[] = [
  { to: '/estate', label: 'Estate planning', icon: Landmark },
]

export const SETTINGS_NAV: NavItem = { to: '/settings', label: 'Settings', icon: Settings, key: 's' }

export const SETTINGS_SECTIONS = [
  { to: '/settings/profile', label: 'Profile' },
  { to: '/settings/currencies', label: 'Currencies and rates' },
  { to: '/settings/preferences', label: 'Preferences' },
  { to: '/settings/categories', label: 'Categories' },
  { to: '/settings/institutions', label: 'Institutions' },
  { to: '/settings/instruments', label: 'Instruments' },
  { to: '/settings/security', label: 'Security' },
  { to: '/settings/ai', label: 'AI provider' },
  { to: '/settings/api-keys', label: 'API keys' },
  { to: '/settings/data', label: 'Export and restore' },
] as const

export const INSIGHT_SECTIONS = [
  { to: '/insights/net-worth', label: 'Net worth' },
  { to: '/insights/allocation', label: 'Allocation' },
  { to: '/insights/income', label: 'Income and returns' },
  { to: '/insights/compare', label: 'Compare accounts' },
] as const
