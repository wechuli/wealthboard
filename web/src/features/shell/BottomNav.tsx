import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { LogOut, Menu as MenuIcon, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { usePrefs } from '@/lib/prefs'
import { usePrivacy } from '@/lib/privacy'
import { useSession } from '@/lib/session'
import { useTheme } from '@/lib/theme-context'
import type { ThemePreference } from '@/lib/theme'
import { Sheet } from '@/components/ui/Dialog'
import { Segmented } from '@/components/ui/Segmented'
import { SwitchField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { useRecorder } from '@/features/recording/recorder'
import { PLANNING_NAV, PRIMARY_NAV, SETTINGS_NAV, type NavItem } from './nav'
import { initials } from './UserMenu'

function Tab({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-accent' : 'text-muted')}
    >
      {({ isActive }) => (
        <>
          <Icon size={21} strokeWidth={isActive ? 2.1 : 1.75} aria-hidden />
          {item.label}
        </>
      )}
    </NavLink>
  )
}

/** Mobile bottom navigation with a raised, central Add action. */
export function BottomNav() {
  const recorder = useRecorder()
  const [menuOpen, setMenuOpen] = useState(false)
  const [home, accounts, , goals] = PRIMARY_NAV
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden"
        style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, transparent)' }}
        data-no-print
      >
        <div className="flex h-[var(--bottombar-h)] items-stretch px-1">
          <Tab item={home!} />
          <Tab item={accounts!} />
          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => recorder.open()}
              aria-label="Add"
              className="-mt-6 grid size-14 place-items-center rounded-full bg-accent text-on-accent shadow-e3 ring-4 ring-[var(--bg)] transition-transform duration-[var(--dur-1)] active:scale-95"
            >
              <Plus size={26} aria-hidden />
            </button>
          </div>
          <Tab item={goals!} />
          <button type="button" onClick={() => setMenuOpen(true)} className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted" aria-haspopup="dialog">
            <MenuIcon size={21} strokeWidth={1.75} aria-hidden />
            Menu
          </button>
        </div>
      </nav>
      <MobileMenu open={menuOpen} onOpenChange={setMenuOpen} />
    </>
  )
}

function MobileMenu({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const { user, signOut } = useSession()
  const { displayName } = usePrefs()
  const privacy = usePrivacy()
  const theme = useTheme()
  const navigate = useNavigate()
  const close = () => onOpenChange(false)
  const items = [PRIMARY_NAV[2]!, PRIMARY_NAV[4]!, SETTINGS_NAV]
  const name = displayName || user?.username || ''
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Menu">
      <div className="mb-5 flex items-center gap-3 rounded-lg border border-line bg-sunken/60 p-3">
        <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{initials(name)}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{name}</p>
          <p className="truncate text-sm text-muted">@{user?.username}</p>
        </div>
      </div>
      <nav aria-label="More" className="flex flex-col">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} onClick={close} className="flex min-h-12 items-center gap-3 rounded-md px-2 text-base font-medium text-ink hover:bg-sunken">
            <item.icon size={20} strokeWidth={1.75} aria-hidden className="text-muted" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <p className="mb-1 mt-5 px-2 text-xs font-medium text-subtle">Planning</p>
      <nav aria-label="Planning" className="flex flex-col">
        {PLANNING_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} onClick={close} className="flex min-h-12 items-center gap-3 rounded-md px-2 text-base font-medium text-ink hover:bg-sunken">
            <item.icon size={20} strokeWidth={1.75} aria-hidden className="text-muted" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6 space-y-4 border-t border-line pt-5">
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Appearance</p>
          <Segmented<ThemePreference>
            label="Appearance"
            value={theme.preference}
            onChange={theme.setPreference}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <SwitchField label="Hide values" description="Masks every amount on screen. Shortcut: Shift H." checked={privacy.hidden} onCheckedChange={privacy.setHidden} />
      </div>
      <Button
        variant="secondary"
        className="mt-6 w-full"
        icon={<LogOut size={16} aria-hidden />}
        onClick={async () => {
          close()
          await signOut()
          navigate('/sign-in', { replace: true })
        }}
      >
        Sign out
      </Button>
    </Sheet>
  )
}
