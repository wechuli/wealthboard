import { ExternalLink, LineChart, Link2, MoreHorizontal, Pencil, Scale, Tag, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import type { Account, ActivityItem } from '@/api/types'
import { DateText, Money, UnitPrice } from '@/components/format'
import { IconButton } from '@/components/ui/Button'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tooltip } from '@/components/ui/Tooltip'
import { useRecorder } from '@/features/recording/recorder'
import { cn } from '@/lib/cn'
import { relativeDays } from '@/lib/dates'
import { minorSign } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { activityEffect } from '@/lib/activity'
import { ActivityIcon, describeActivity, isEditable } from './activityMeta'

export interface DateGroup {
  date: string
  items: ActivityItem[]
}

export function groupByDate(items: ActivityItem[]): DateGroup[] {
  const groups: DateGroup[] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last && last.date === item.date) last.items.push(item)
    else groups.push({ date: item.date, items: [item] })
  }
  return groups
}

export interface RowActions {
  onEdit(item: ActivityItem): void
  onDelete(item: ActivityItem): void
}

const STICKY_TOP = 'top-[calc(var(--topbar-h)+env(safe-area-inset-top))]'

function DateHeading({ date }: { date: string }) {
  const { today, timezone } = usePrefs()
  const rel = relativeDays(date, today, timezone)
  const showRel = rel === 'Today' || rel === 'Yesterday'
  return (
    <span className="flex items-baseline gap-2">
      {showRel ? <span className="font-semibold text-ink">{rel}</span> : null}
      <DateText value={date} className={showRel ? 'text-muted' : 'font-semibold text-ink'} />
    </span>
  )
}

function TransferHint() {
  return (
    <Tooltip content="Recorded in both accounts. Deleting removes both legs.">
      <button type="button" className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-sm text-xs font-medium text-info">
        <Link2 size={13} aria-hidden />
        Paired transfer
      </button>
    </Tooltip>
  )
}

/** Amount column: signed effect, a valuation's new value, or a unit price. */
function Amount({ item, isLiability, align = 'right' }: { item: ActivityItem; isLiability: boolean; align?: 'right' | 'left' }) {
  const box = cn('flex flex-col', align === 'right' ? 'items-end text-right' : 'items-start')
  if (item.kind === 'price')
    return (
      <div className={box}>
        <UnitPrice value={item.unitPrice} currency={item.currency} className="font-medium text-ink" />
        <span className="text-xs text-subtle">per unit</span>
      </div>
    )
  if (item.kind === 'valuation')
    return (
      <div className={box}>
        <span className="text-xs text-subtle">Value set to</span>
        <Money minor={item.amountMinor} currency={item.currency} className="font-medium text-ink" />
      </div>
    )
  const effect = activityEffect(item)
  const s = minorSign(effect)
  const tone = s > 0 && !isLiability ? 'text-positive' : 'text-ink'
  return (
    <div className={box}>
      <Money minor={effect} currency={item.currency} sign="always" className={cn('font-medium', tone)} />
      {item.kind === 'position' ? <span className="text-xs text-subtle">{s === 0 ? 'No cash effect' : 'Cash effect'}</span> : null}
      {isLiability && s !== 0 ? <span className="text-xs text-subtle">{s > 0 ? 'Owed more' : 'Owed less'}</span> : null}
    </div>
  )
}

function RowMenu({ item, plain, actions }: { item: ActivityItem; plain: string; actions: RowActions }) {
  const navigate = useNavigate()
  const recorder = useRecorder()
  const online = useOnline()
  const editable = isEditable(item)
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton label={`Actions for ${plain}`} icon={<MoreHorizontal size={18} aria-hidden />} tooltip={false} />
      </MenuTrigger>
      <MenuContent>
        {editable ? (
          <MenuItem icon={<Pencil />} onSelect={() => actions.onEdit(item)} disabled={!online} hint={online ? undefined : 'Offline'}>
            Edit
          </MenuItem>
        ) : null}
        {item.kind === 'valuation' ? (
          <MenuItem icon={<Scale />} onSelect={() => recorder.open({ action: 'valuation', accountId: item.accountId })}>
            Record a new value
          </MenuItem>
        ) : null}
        {item.kind === 'price' && item.instrumentId ? (
          <MenuItem
            icon={<Tag />}
            onSelect={() =>
              recorder.open({
                action: 'price',
                instrumentId: item.instrumentId,
              })
            }
          >
            Update price
          </MenuItem>
        ) : null}
        <MenuItem icon={<ExternalLink />} onSelect={() => navigate(`/accounts/${item.accountId}`)}>
          Open {item.accountName}
        </MenuItem>
        {item.instrumentId ? (
          <MenuItem icon={<LineChart />} onSelect={() => navigate(`/instruments/${item.instrumentId}`)}>
            View {item.instrumentSymbol || item.instrumentName || 'instrument'}
          </MenuItem>
        ) : null}
        {!editable && item.kind === 'transaction' ? (
          <p className="px-2.5 py-1.5 text-xs text-subtle">{item.type === 'transfer' ? 'Transfers can be deleted, not edited.' : 'Opening balances can be deleted, not edited.'}</p>
        ) : null}
        <MenuSeparator />
        <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => actions.onDelete(item)} disabled={!online} hint={online ? undefined : 'Offline'}>
          {item.kind === 'transaction' && item.type === 'transfer' ? 'Delete both legs' : 'Delete'}
        </MenuItem>
        {!online ? <p className="px-2.5 pb-1 pt-1.5 text-xs text-subtle">{OFFLINE_REASON}</p> : null}
      </MenuContent>
    </MenuRoot>
  )
}

function SubLine({ item, withAccount }: { item: ActivityItem; withAccount?: boolean }) {
  const parts = [item.description, item.notes].filter((p): p is string => !!p && p.trim().length > 0)
  const paired = item.kind === 'transaction' && item.type === 'transfer' && !!item.eventGroupId
  if (!withAccount && parts.length === 0 && !paired) return null
  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted">
      {withAccount ? (
        <Link to={`/accounts/${item.accountId}`} className="min-w-0 shrink truncate hover:text-ink hover:underline">
          {item.accountName}
        </Link>
      ) : null}
      {withAccount && parts.length > 0 ? (
        <span aria-hidden className="text-subtle">
          ·
        </span>
      ) : null}
      {parts.length > 0 ? <span className="min-w-0 flex-1 truncate">{parts.join(' — ')}</span> : null}
      {paired ? <TransferHint /> : null}
    </p>
  )
}

/** Desktop: a dense semantic table with sticky date rows. */
export function LedgerTable({ groups, accounts, actions }: { groups: DateGroup[]; accounts: Map<string, Account>; actions: RowActions }) {
  return (
    <table className="hidden w-full table-fixed border-separate border-spacing-0 text-left md:table">
      <caption className="sr-only">Activity across all accounts, newest first</caption>
      <colgroup>
        <col />
        <col className="w-[22%]" />
        <col className="w-[11.5rem] lg:w-[13rem]" />
        <col className="w-14" />
      </colgroup>
      <thead>
        <tr className="text-xs font-medium text-subtle">
          <th scope="col" className="px-5 pb-2 pt-4 font-medium">
            Entry
          </th>
          <th scope="col" className="px-3 pb-2 pt-4 font-medium">
            Account
          </th>
          <th scope="col" className="px-3 pb-2 pt-4 text-right font-medium">
            Amount
          </th>
          <th scope="col" className="pb-2 pr-3 pt-4">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      {groups.map((g) => (
        <tbody key={g.date}>
          <tr>
            <th scope="colgroup" colSpan={4} className={cn('sticky z-[1] border-y border-line bg-sunken/95 px-5 py-2 text-left text-sm font-normal', STICKY_TOP)}>
              <DateHeading date={g.date} />
            </th>
          </tr>
          {g.items.map((item, i) => {
            const { title, plain } = describeActivity(item)
            const account = accounts.get(item.accountId)
            return (
              <tr key={`${item.kind}-${item.id}-${item.accountId}`} className="group transition-colors duration-[var(--dur-1)] hover:bg-sunken/45">
                <td className={cn('px-5 py-3 align-middle', i > 0 && 'border-t border-line/70')}>
                  <div className="flex min-w-0 items-center gap-3">
                    <ActivityIcon type={item.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{title}</p>
                      <SubLine item={item} />
                    </div>
                  </div>
                </td>
                <td className={cn('px-3 py-3 align-middle text-sm', i > 0 && 'border-t border-line/70')}>
                  <Link to={`/accounts/${item.accountId}`} className="block truncate text-muted hover:text-ink hover:underline">
                    {item.accountName}
                  </Link>
                  {account?.archivedAt ? <span className="text-xs text-subtle">Archived</span> : null}
                </td>
                <td className={cn('px-3 py-3 align-middle', i > 0 && 'border-t border-line/70')}>
                  <Amount item={item} isLiability={!!account?.isLiability} />
                </td>
                <td className={cn('py-3 pr-3 text-right align-middle', i > 0 && 'border-t border-line/70')}>
                  <RowMenu item={item} plain={plain} actions={actions} />
                </td>
              </tr>
            )
          })}
        </tbody>
      ))}
    </table>
  )
}

/** Mobile: a compact list (no horizontal scroll at 360 px). */
export function LedgerList({ groups, accounts, actions }: { groups: DateGroup[]; accounts: Map<string, Account>; actions: RowActions }) {
  return (
    <div className="md:hidden">
      {groups.map((g) => (
        <section key={g.date} aria-labelledby={`ledger-day-${g.date}`}>
          <h2 id={`ledger-day-${g.date}`} className={cn('sticky z-[1] border-y border-line bg-sunken/95 px-4 py-2 text-sm font-normal', STICKY_TOP)}>
            <DateHeading date={g.date} />
          </h2>
          <ul>
            {g.items.map((item, i) => {
              const { title, plain } = describeActivity(item)
              const account = accounts.get(item.accountId)
              return (
                <li key={`${item.kind}-${item.id}-${item.accountId}`} className={cn('flex items-start gap-3 py-3 pl-4 pr-1', i > 0 && 'border-t border-line/70')}>
                  <ActivityIcon type={item.type} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-medium leading-snug text-ink">{title}</p>
                      <div className="shrink-0 pt-px">
                        <Amount item={item} isLiability={!!account?.isLiability} />
                      </div>
                    </div>
                    <SubLine item={item} withAccount />
                  </div>
                  <div className="-my-1 shrink-0">
                    <RowMenu item={item} plain={plain} actions={actions} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function LedgerSkeleton() {
  return (
    <div role="status" aria-label="Loading activity">
      {[0, 1].map((g) => (
        <div key={g}>
          <div className="border-y border-line bg-sunken/70 px-4 py-2.5 md:px-5">
            <Skeleton className="h-4 w-28" />
          </div>
          {Array.from({ length: g === 0 ? 4 : 3 }, (_, i) => (
            <div key={i} className={cn('flex items-center gap-3 px-4 py-3.5 md:px-5', i > 0 && 'border-t border-line/70')}>
              <Skeleton className="size-9 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-40 max-w-[60%]" />
                <Skeleton className="mt-2 h-3 w-56 max-w-[80%]" />
              </div>
              <Skeleton className="hidden h-4 w-28 md:block" />
              <Skeleton className="h-4 w-24 md:w-32" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
