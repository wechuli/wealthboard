import { Download, Keyboard, LogOut, Monitor, Moon, Settings, Sun, User } from 'lucide-react'
import { useNavigate } from 'react-router'
import { usePrefs } from '@/lib/prefs'
import { useSession } from '@/lib/session'
import { useTheme } from '@/lib/theme-context'
import type { ThemePreference } from '@/lib/theme'
import { MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu'
import { useInstallPrompt } from './PwaPrompts'

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts.at(-1)![0] ?? '') : '')).toUpperCase()
}

export function UserMenu() {
  const { user, signOut } = useSession()
  const { displayName } = usePrefs()
  const theme = useTheme()
  const navigate = useNavigate()
  const install = useInstallPrompt()
  const name = displayName || user?.username || ''
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button type="button" aria-label={`Profile menu for ${name}`} className="ml-1 grid size-11 place-items-center rounded-full md:size-10">
          <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent ring-1 ring-accent/20">{initials(name)}</span>
        </button>
      </MenuTrigger>
      <MenuContent>
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          <p className="truncate text-xs text-muted">@{user?.username}</p>
        </div>
        <MenuSeparator />
        <MenuItem icon={<User />} onSelect={() => navigate('/settings/profile')}>
          Profile
        </MenuItem>
        <MenuItem icon={<Settings />} onSelect={() => navigate('/settings')} hint="G S">
          Settings
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Appearance</MenuLabel>
        <MenuRadioGroup value={theme.preference} onValueChange={(v) => theme.setPreference(v as ThemePreference)}>
          <MenuRadioItem value="system" icon={<Monitor />}>
            System
          </MenuRadioItem>
          <MenuRadioItem value="light" icon={<Sun />}>
            Light
          </MenuRadioItem>
          <MenuRadioItem value="dark" icon={<Moon />}>
            Dark
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        {install.available ? (
          <MenuItem icon={<Download />} onSelect={install.prompt}>
            Install app
          </MenuItem>
        ) : null}
        <MenuItem icon={<Keyboard />} onSelect={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))} hint="?">
          Keyboard shortcuts
        </MenuItem>
        <MenuItem
          icon={<LogOut />}
          onSelect={async () => {
            await signOut()
            navigate('/sign-in', { replace: true })
          }}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  )
}
