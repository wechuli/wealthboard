import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { Coins, DatabaseBackup, KeyRound, Landmark, LineChart, ShieldCheck, SlidersHorizontal, Tags, UserRound, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/cn'
import { SETTINGS_SECTIONS } from '@/features/shell/nav'

const ICONS: Record<string, LucideIcon> = {
  '/settings/profile': UserRound,
  '/settings/currencies': Coins,
  '/settings/preferences': SlidersHorizontal,
  '/settings/categories': Tags,
  '/settings/institutions': Landmark,
  '/settings/instruments': LineChart,
  '/settings/security': ShieldCheck,
  '/settings/api-keys': KeyRound,
  '/settings/data': DatabaseBackup,
}

/** Sections are grouped in the desktop list with a hairline between groups (no labels). */
const GROUP_BREAKS = new Set(['/settings/categories', '/settings/security', '/settings/data'])

function DesktopNav() {
  return (
    <nav aria-label="Settings sections" className="sticky top-[calc(var(--topbar-h)+20px)] hidden self-start lg:block">
      <ul className="flex flex-col gap-0.5">
        {SETTINGS_SECTIONS.map((s) => {
          const Icon = ICONS[s.to] ?? SlidersHorizontal
          return (
            <li key={s.to} className={cn(GROUP_BREAKS.has(s.to) && 'mt-2 border-t border-line pt-2')}>
              <NavLink
                to={s.to}
                className={({ isActive }) =>
                  cn(
                    'group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-[var(--dur-1)]',
                    isActive ? 'bg-surface text-ink shadow-e1 dark:bg-raised' : 'text-muted hover:bg-surface/70 hover:text-ink dark:hover:bg-raised/60',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={17} strokeWidth={isActive ? 2.1 : 1.75} aria-hidden className={cn('shrink-0', isActive ? 'text-accent' : 'text-subtle group-hover:text-muted')} />
                    <span className="truncate">{s.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Below 1024 px: a horizontally scrolling row of section pills; the active one is scrolled into view. */
function MobileNav() {
  const { pathname } = useLocation()
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' })
  }, [pathname])
  return (
    <nav aria-label="Settings sections" className="-mx-4 mb-5 md:-mx-7 lg:hidden">
      <ul ref={listRef} className="scroll-x flex gap-1.5 px-4 pb-1 md:px-7">
        {SETTINGS_SECTIONS.map((s) => {
          const Icon = ICONS[s.to] ?? SlidersHorizontal
          return (
            <li key={s.to} className="shrink-0">
              <NavLink
                to={s.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors duration-[var(--dur-1)] md:h-10',
                    isActive ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
                  )
                }
              >
                <Icon size={16} aria-hidden className="shrink-0" />
                {s.label}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default function SettingsLayout() {
  return (
    <div className="page">
      <PageHeader title="Settings" description="Your profile, currencies, and preferences, plus the categories, institutions, and instruments behind your accounts." />
      <MobileNav />
      <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10 xl:gap-12">
        <DesktopNav />
        <div className="min-w-0 max-w-[880px]">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
