import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate, useResolvedPath, useSearchParams } from 'react-router'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useGlobalHotkeys } from '@/lib/hotkeys'
import { usePrefs } from '@/lib/prefs'
import { usePrivacy } from '@/lib/privacy'
import { Tooltip } from '@/components/ui/Tooltip'
import { Kbd } from '@/components/ui/Kbd'
import { RecorderProvider, useRecorder, type RecordAction } from '@/features/recording/recorder'
import { BrandMark, BrandName } from './Brand'
import { CommandPalette } from './CommandPalette'
import { PLANNING_NAV, PRIMARY_NAV, SETTINGS_NAV, type NavItem } from './nav'
import { OfflineBanner } from './OfflineBanner'
import { PwaPrompts } from './PwaPrompts'
import { ShortcutsDialog } from './ShortcutsDialog'
import { TopBar } from './TopBar'
import { BottomNav } from './BottomNav'

// Dev-only: the dynamic import sits behind import.meta.env.DEV so production builds drop it.
const DevScenarioSwitcher = import.meta.env.DEV && import.meta.env.VITE_DATA_SOURCE === 'mock' ? lazy(() => import('@/features/dev/DevScenarioSwitcher').then((m) => ({ default: m.DevScenarioSwitcher }))) : null

function SideLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  const resolved = useResolvedPath(item.to)
  const isActive = !!useMatch({ path: resolved.pathname, end: item.end ?? false })
  return (
    <Tooltip content={item.label} side="right">
      <Link
        to={item.to}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'group flex h-11 items-center gap-3 rounded-md px-3 text-[0.9375rem] font-medium transition-colors duration-[var(--dur-1)] md:justify-center lg:h-10 lg:justify-start',
          isActive ? 'bg-surface text-ink shadow-e1 dark:bg-raised' : 'text-muted hover:bg-surface/60 hover:text-ink dark:hover:bg-raised/60',
        )}
      >
        <Icon size={19} strokeWidth={isActive ? 2.1 : 1.75} aria-hidden className={cn('shrink-0', isActive && 'text-accent')} />
        <span className="md:sr-only lg:not-sr-only">{item.label}</span>
      </Link>
    </Tooltip>
  )
}

function Sidebar() {
  const { appName } = usePrefs()
  const recorder = useRecorder()
  return (
    <aside
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-30 hidden w-[var(--rail-w)] flex-col border-r border-line px-3 py-4 md:flex lg:w-[var(--sidebar-w)] lg:px-4"
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface-sunken) 75%, var(--bg))' }}
      data-no-print
    >
      <NavLink to="/" className="mb-6 flex h-10 items-center gap-2.5 rounded-md px-1.5 md:justify-center lg:justify-start" aria-label={`${appName} home`}>
        <BrandMark size={30} />
        <BrandName name={appName} className="hidden lg:inline" />
      </NavLink>
      <Tooltip content="Record something" shortcut="N" side="right">
        <button
          type="button"
          onClick={() => recorder.open()}
          className="mb-6 flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent shadow-e1 transition-colors duration-[var(--dur-1)] hover:bg-accent-strong lg:justify-between"
        >
          <span className="flex items-center gap-2">
            <Plus size={18} aria-hidden />
            <span className="md:sr-only lg:not-sr-only">Add</span>
          </span>
          <span className="hidden lg:inline">
            <Kbd tone="inverse">N</Kbd>
          </span>
        </button>
      </Tooltip>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {PRIMARY_NAV.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="mt-8">
        <p className="mb-1.5 hidden px-3 text-xs font-medium text-subtle lg:block">Planning</p>
        <nav aria-label="Planning" className="flex flex-col gap-1">
          {PLANNING_NAV.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </nav>
      </div>
      <div className="mt-auto">
        <SideLink item={SETTINGS_NAV} />
      </div>
    </aside>
  )
}

const RECORD_ACTIONS: readonly RecordAction[] = ['deposit', 'withdrawal', 'interest', 'dividend', 'fee', 'valuation', 'buy', 'sell', 'price', 'transfer', 'payment', 'increase', 'goal']

/**
 * Deep link into quick add: `?record=<action>` (optionally `&accountId=` / `&instrumentId=`) on any
 * page opens the recorder, then removes the parameters. `?record=1` opens the action picker.
 */
function RecordFromUrl() {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const recorder = useRecorder()
  const record = params.get('record')
  useEffect(() => {
    if (!record) return
    const accountMatch = pathname.match(/^\/accounts\/([0-9a-f-]{36})/)
    const action = RECORD_ACTIONS.find((a) => a === record)
    recorder.open({ action, accountId: params.get('accountId') ?? accountMatch?.[1] ?? undefined, instrumentId: params.get('instrumentId') ?? undefined })
    const next = new URLSearchParams(params)
    for (const key of ['record', 'accountId', 'instrumentId']) next.delete(key)
    setParams(next, { replace: true })
  }, [record, params, pathname, recorder, setParams])
  return null
}

/** Announces the new page title to screen readers and moves focus to main after navigation. */
function RouteAnnouncer() {
  const { pathname } = useLocation()
  const [message, setMessage] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => {
      setMessage(document.title)
      const main = document.getElementById('main')
      if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true })
    }, 120)
    return () => window.clearTimeout(t)
  }, [pathname])
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  )
}

function ShellInner() {
  const navigate = useNavigate()
  const recorder = useRecorder()
  const privacy = usePrivacy()
  const { pathname } = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const accountMatch = pathname.match(/^\/accounts\/([0-9a-f-]{36})/)

  useGlobalHotkeys({
    onPalette: () => setPaletteOpen(true),
    onQuickAdd: () => recorder.open(accountMatch ? { accountId: accountMatch[1] } : {}),
    onPrivacy: () => privacy.toggle(),
    onHelp: () => setHelpOpen(true),
    onGo: (k) => {
      const target = [...PRIMARY_NAV, SETTINGS_NAV].find((n) => n.key === k)
      if (target) navigate(target.to)
    },
  })

  return (
    <div data-app-shell className="min-h-dvh md:pl-[var(--rail-w)] lg:pl-[var(--sidebar-w)]">
      <a href="#main" className="sr-only-focusable fixed left-3 top-3 z-[60] rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent">
        Skip to content
      </a>
      <Sidebar />
      <TopBar onOpenPalette={() => setPaletteOpen(true)} onOpenShortcuts={() => setHelpOpen(true)} />
      <OfflineBanner />
      <main id="main" tabIndex={-1} className="outline-none pb-[calc(var(--bottombar-h)+env(safe-area-inset-bottom)+8px)] md:pb-0">
        <div key={pathname} className="route-enter">
          <Outlet />
        </div>
      </main>
      <BottomNav />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onShowShortcuts={() => setHelpOpen(true)} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <RouteAnnouncer />
      <RecordFromUrl />
      <PwaPrompts />
      {DevScenarioSwitcher ? (
        <Suspense fallback={null}>
          <DevScenarioSwitcher />
        </Suspense>
      ) : null}
    </div>
  )
}

export function AppShell() {
  return (
    <RecorderProvider>
      <ShellInner />
    </RecorderProvider>
  )
}
