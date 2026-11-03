import { Command } from 'cmdk'
import { Dialog as D } from 'radix-ui'
import { ArrowLeftRight, CandlestickChart, Eye, FileUp, Keyboard, Monitor, Moon, Plus, Search, Sun, Target, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useAccounts, useGoals, useInstruments } from '@/lib/queries'
import { usePrivacy } from '@/lib/privacy'
import { useTheme } from '@/lib/theme-context'
import { CategoryIcon } from '@/components/CategoryIcon'
import { useRecorder, type RecordAction } from '@/features/recording/recorder'
import { INSIGHT_SECTIONS, PLANNING_NAV, PRIMARY_NAV, SETTINGS_SECTIONS } from './nav'

const RECORD_ACTIONS: { action: RecordAction; label: string; keywords: string[] }[] = [
  { action: 'deposit', label: 'Record a deposit', keywords: ['add money', 'contribution', 'top up'] },
  { action: 'withdrawal', label: 'Record a withdrawal', keywords: ['take out'] },
  { action: 'valuation', label: 'Update a value', keywords: ['valuation', 'revalue', 'land', 'car'] },
  { action: 'buy', label: 'Record a buy', keywords: ['trade', 'purchase', 'shares'] },
  { action: 'sell', label: 'Record a sell', keywords: ['trade', 'sale', 'shares'] },
  { action: 'price', label: 'Update a price', keywords: ['quote', 'stock', 'etf'] },
  { action: 'interest', label: 'Record interest', keywords: ['income'] },
  { action: 'dividend', label: 'Record a dividend', keywords: ['income'] },
  { action: 'fee', label: 'Record a fee', keywords: ['charge', 'cost'] },
  { action: 'transfer', label: 'Transfer between accounts', keywords: ['move money'] },
  { action: 'account', label: 'Add an account', keywords: ['new account', 'asset', 'liability'] },
  { action: 'goal', label: 'Create a goal', keywords: ['target', 'plan'] },
]

function Item({ children, onSelect, icon, value, keywords, hint }: { children: ReactNode; onSelect(): void; icon?: ReactNode; value: string; keywords?: string[]; hint?: ReactNode }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-ink data-[selected=true]:bg-sunken"
    >
      <span className="text-muted [&>svg]:size-[18px]" aria-hidden>
        {icon}
      </span>
      <span className="flex-1 truncate">{children}</span>
      {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </Command.Item>
  )
}

const groupClass = 'px-1.5 py-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle'

/** ⌘K command palette: navigation, records, accounts, goals, instruments, theme, and privacy. */
export function CommandPalette({ open, onOpenChange, onShowShortcuts }: { open: boolean; onOpenChange(o: boolean): void; onShowShortcuts(): void }) {
  const navigate = useNavigate()
  const recorder = useRecorder()
  const privacy = usePrivacy()
  const theme = useTheme()
  const accounts = useAccounts('active')
  const goals = useGoals()
  const instruments = useInstruments()
  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="wb-overlay fixed inset-0 z-50 bg-scrim" />
        <D.Content className="wb-dialog fixed left-1/2 top-[max(12px,10dvh)] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-raised shadow-e3">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search pages, accounts, goals, and actions.</D.Description>
          <Command label="Command palette" loop>
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={18} aria-hidden className="text-subtle" />
              <Command.Input placeholder="Search or type a command…" className="h-14 w-full bg-transparent text-base text-ink outline-none placeholder:text-subtle" />
            </div>
            <Command.List className="max-h-[min(60dvh,440px)] overflow-y-auto overscroll-contain py-1">
              <Command.Empty className="px-4 py-10 text-center text-sm text-muted">No matches. Try an account name, “deposit”, or “settings”.</Command.Empty>
              <Command.Group heading="Record" className={groupClass}>
                {RECORD_ACTIONS.slice(0, 6).map((a) => (
                  <Item key={a.action} value={a.label} keywords={a.keywords} icon={<Plus />} onSelect={() => run(() => recorder.open({ action: a.action }))}>
                    {a.label}
                  </Item>
                ))}
              </Command.Group>
              <Command.Group heading="Go to" className={groupClass}>
                {PRIMARY_NAV.map((n) => (
                  <Item key={n.to} value={`Go to ${n.label}`} icon={<n.icon />} onSelect={() => run(() => navigate(n.to))} hint={n.key ? `G ${n.key.toUpperCase()}` : undefined}>
                    {n.label}
                  </Item>
                ))}
                {INSIGHT_SECTIONS.map((n) => (
                  <Item key={n.to} value={`Insights ${n.label}`} icon={<CandlestickChart />} onSelect={() => run(() => navigate(n.to))}>
                    Insights · {n.label}
                  </Item>
                ))}
                {SETTINGS_SECTIONS.map((n) => (
                  <Item key={n.to} value={`Settings ${n.label}`} icon={<Monitor />} onSelect={() => run(() => navigate(n.to))}>
                    Settings · {n.label}
                  </Item>
                ))}
                {PLANNING_NAV.map((n) => (
                  <Item key={n.to} value={`Planning ${n.label}`} icon={<n.icon />} onSelect={() => run(() => navigate(n.to))}>
                    Planning · {n.label}
                  </Item>
                ))}
              </Command.Group>
              {accounts.data?.length ? (
                <Command.Group heading="Accounts" className={groupClass}>
                  {accounts.data.map((a) => (
                    <Item key={a.id} value={`Account ${a.name} ${a.institutionName ?? ''} ${a.categoryName}`} icon={<Wallet />} onSelect={() => run(() => navigate(`/accounts/${a.id}`))} hint={a.currency}>
                      {a.name}
                    </Item>
                  ))}
                </Command.Group>
              ) : null}
              {goals.data?.length ? (
                <Command.Group heading="Goals" className={groupClass}>
                  {goals.data.map((g) => (
                    <Item key={g.id} value={`Goal ${g.name}`} icon={<CategoryIcon name={g.icon} />} onSelect={() => run(() => navigate(`/goals/${g.id}`))}>
                      {g.name}
                    </Item>
                  ))}
                </Command.Group>
              ) : null}
              {instruments.data?.length ? (
                <Command.Group heading="Instruments" className={groupClass}>
                  {instruments.data.map((i) => (
                    <Item key={i.id} value={`Instrument ${i.symbol ?? ''} ${i.name}`} icon={<CandlestickChart />} onSelect={() => run(() => navigate(`/instruments/${i.id}`))} hint={i.symbol ?? undefined}>
                      {i.name}
                    </Item>
                  ))}
                </Command.Group>
              ) : null}
              <Command.Group heading="More actions" className={groupClass}>
                {RECORD_ACTIONS.slice(6).map((a) => (
                  <Item key={a.action} value={a.label} keywords={a.keywords} icon={a.action === 'goal' ? <Target /> : a.action === 'transfer' ? <ArrowLeftRight /> : <Plus />} onSelect={() => run(() => recorder.open({ action: a.action }))}>
                    {a.label}
                  </Item>
                ))}
                <Item value="Import account history CSV JSON" icon={<FileUp />} onSelect={() => run(() => navigate('/accounts?import=1'))}>
                  Import account history
                </Item>
                <Item value={privacy.hidden ? 'Show values' : 'Hide values privacy'} icon={<Eye />} onSelect={() => run(privacy.toggle)} hint="⇧H">
                  {privacy.hidden ? 'Show values' : 'Hide values'}
                </Item>
                <Item value="Theme light appearance" icon={<Sun />} onSelect={() => run(() => theme.setPreference('light'))}>
                  Use light theme
                </Item>
                <Item value="Theme dark appearance" icon={<Moon />} onSelect={() => run(() => theme.setPreference('dark'))}>
                  Use dark theme
                </Item>
                <Item value="Theme system appearance" icon={<Monitor />} onSelect={() => run(() => theme.setPreference('system'))}>
                  Match system theme
                </Item>
                <Item value="Keyboard shortcuts help" icon={<Keyboard />} onSelect={() => run(onShowShortcuts)} hint="?">
                  Keyboard shortcuts
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
