import { Bell, Eye, EyeOff, Search, Command } from 'lucide-react'
import { Link } from 'react-router'
import { useAttention } from '@/lib/queries'
import { usePrefs } from '@/lib/prefs'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/cn'
import { IconButton } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { PopoverContent, PopoverRoot, PopoverTrigger } from '@/components/ui/Popover'
import { Tooltip } from '@/components/ui/Tooltip'
import { BrandMark, BrandName } from './Brand'
import { AttentionList } from './AttentionList'
import { UserMenu } from './UserMenu'

function AttentionButton() {
  const { data } = useAttention()
  const items = data?.items ?? []
  const warnings = items.filter((i) => i.severity === 'warning').length
  const label = items.length === 0 ? 'Nothing needs attention' : `${items.length} item${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} attention`
  return (
    <PopoverRoot>
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={label} className="relative grid size-11 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink md:size-10">
            <Bell size={19} aria-hidden strokeWidth={1.75} />
            {items.length > 0 ? (
              <span
                aria-hidden
                className={cn('absolute right-2.5 top-2.5 size-2.5 rounded-full ring-2 ring-[var(--bg)]', warnings > 0 || data?.totalsComplete === false ? 'bg-warning' : 'bg-info')}
              />
            ) : null}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent label="Needs attention">
        <div className="border-b border-line px-4 py-3">
          <p className="text-sm font-semibold text-ink">Needs attention</p>
          <p className="text-xs text-muted">{data?.totalsComplete === false ? 'Your totals are incomplete until these are fixed.' : 'Your totals are complete.'}</p>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto p-2">
          <AttentionList items={items} compact />
        </div>
      </PopoverContent>
    </PopoverRoot>
  )
}

export function TopBar({ onOpenPalette, onOpenShortcuts }: { onOpenPalette(): void; onOpenShortcuts(): void }) {
  const privacy = usePrivacy()
  const { appName } = usePrefs()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <header
      className="sticky top-0 z-20 border-b border-line/70 backdrop-blur-[6px] pt-[env(safe-area-inset-top)]"
      style={{ backgroundColor: 'color-mix(in oklab, var(--bg) 88%, transparent)' }}
      data-no-print
    >
      <div className="mx-auto flex h-[var(--topbar-h)] max-w-[calc(var(--content-max)+80px)] items-center gap-2 px-3 md:px-6 lg:px-10">
        <Link to="/" className="mr-1 flex min-w-0 items-center gap-2 rounded-md md:hidden" aria-label={`${appName} home`}>
          <BrandMark size={28} />
          <BrandName name={appName} className="hidden truncate text-[1.0625rem] min-[420px]:inline" />
        </Link>
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden h-10 w-full max-w-sm items-center gap-2.5 rounded-md border border-line bg-surface px-3 text-left text-sm text-subtle shadow-e1 transition-colors hover:border-line-strong hover:text-muted md:flex"
        >
          <Search size={16} aria-hidden />
          <span className="flex-1">Search or jump to…</span>
          <span className="flex gap-1">
            <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <span className="contents md:hidden">
            <IconButton label="Search" icon={<Search size={19} strokeWidth={1.75} aria-hidden />} onClick={onOpenPalette} />
          </span>
          <AttentionButton />
          <IconButton
            label={privacy.hidden ? 'Show values' : 'Hide values'}
            shortcut="⇧H"
            aria-pressed={privacy.hidden}
            icon={privacy.hidden ? <EyeOff size={19} strokeWidth={1.75} aria-hidden /> : <Eye size={19} strokeWidth={1.75} aria-hidden />}
            onClick={privacy.toggle}
            className={cn(privacy.hidden && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
          />
          <span className="hidden lg:contents">
            <IconButton label="Keyboard shortcuts" icon={<Command size={18} strokeWidth={1.75} aria-hidden />} onClick={onOpenShortcuts} shortcut="?" />
          </span>
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
