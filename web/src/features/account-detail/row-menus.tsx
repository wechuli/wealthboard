/** Row menus for holdings and the investment activity feed: edit, delete, adjust, and undo grouped actions. */
import { ArrowUpRight, MoreHorizontal, Pencil, Scale, Split, Tag, Trash2, TrendingDown, TrendingUp, Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api'
import type { Account, AccountPosition, ActivityItem } from '@/api/types'
import { DateText, Quantity } from '@/components/format'
import { IconButton } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu'
import { activityLabel } from '@/features/accounts/model'
import { useRecorder } from '@/features/recording/recorder'
import { useOnline } from '@/lib/online'
import { useApiMutation } from '@/lib/queries'
import { useAdvancedParams } from './advanced'
import { groupActionLabel } from './advanced-meta'
import { EDITABLE_TYPES } from './TradeSheet'
import { UndoGroupDialog, type UndoTarget } from './undo'
import { WorkflowProblem } from './workflow-kit'

const itemName = (i: ActivityItem) => i.instrumentSymbol || i.instrumentName || 'instrument'

export function HoldingMenu({ account, position }: { account: Account; position: AccountPosition }) {
  const recorder = useRecorder()
  const advanced = useAdvancedParams()
  const navigate = useNavigate()
  const name = position.instrumentSymbol || position.instrumentName
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton label={`Actions for ${name}`} icon={<MoreHorizontal size={16} />} tooltip={false} />
      </MenuTrigger>
      <MenuContent>
        {!account.archivedAt ? (
          <>
            <MenuItem icon={<TrendingUp />} onSelect={() => recorder.open({ action: 'buy', accountId: account.id, instrumentId: position.instrumentId })}>
              Buy more
            </MenuItem>
            <MenuItem icon={<TrendingDown />} onSelect={() => recorder.open({ action: 'sell', accountId: account.id, instrumentId: position.instrumentId })}>
              Sell
            </MenuItem>
            <MenuItem icon={<Tag />} onSelect={() => recorder.open({ action: 'price', accountId: account.id, instrumentId: position.instrumentId })}>
              Update price
            </MenuItem>
            <MenuItem icon={<Scale />} onSelect={() => advanced.newTrade('quantity_adjustment', position.instrumentId)}>
              Adjust quantity
            </MenuItem>
            <MenuItem icon={<Split />} onSelect={() => advanced.open('corporate')}>
              Corporate action
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem icon={<ArrowUpRight />} onSelect={() => navigate(`/instruments/${position.instrumentId}`)}>
          View instrument
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  )
}

/** Menus and confirmation dialogs for the position account's activity feed. */
export function usePositionRowActions(account: Account): { menu(item: ActivityItem): ReactNode; dialogs: ReactNode } {
  const advanced = useAdvancedParams()
  const recorder = useRecorder()
  const [deleting, setDeleting] = useState<ActivityItem | null>(null)
  const [undo, setUndo] = useState<UndoTarget | null>(null)
  const archived = !!account.archivedAt

  const menu = (item: ActivityItem): ReactNode => {
    if (archived) return null
    const grouped = !!item.eventGroupId
    const editable = item.kind === 'position' && !grouped && EDITABLE_TYPES.includes(item.type)
    if (!grouped && !editable && item.kind !== 'price') return null
    const label = grouped ? groupActionLabel(item.type, item.kind) : ''
    const what =
      item.kind === 'position' ? `${activityLabel(item.type).toLowerCase()} of ${itemName(item)}` : item.kind === 'price' ? `${itemName(item)} price` : activityLabel(item.type).toLowerCase()
    return (
      <MenuRoot>
        <MenuTrigger asChild>
          <IconButton label={`Actions for ${what} on ${item.date}`} icon={<MoreHorizontal size={16} />} tooltip={false} />
        </MenuTrigger>
        <MenuContent>
          {editable ? (
            <>
              <MenuItem icon={<Pencil />} onSelect={() => advanced.editTradeById(item.id)}>
                Edit trade
              </MenuItem>
              <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setDeleting(item)}>
                Delete trade
              </MenuItem>
            </>
          ) : null}
          {grouped ? (
            <MenuItem icon={<Undo2 />} tone="danger" onSelect={() => setUndo({ eventId: item.id, label, date: item.date, detail: item.instrumentName ? itemName(item) : undefined })}>
              Undo {label}
            </MenuItem>
          ) : null}
          {item.kind === 'price' && item.instrumentId ? (
            <MenuItem icon={<Tag />} onSelect={() => recorder.open({ action: 'price', accountId: account.id, instrumentId: item.instrumentId })}>
              Add a newer price
            </MenuItem>
          ) : null}
        </MenuContent>
      </MenuRoot>
    )
  }

  const dialogs = (
    <>
      <DeleteActivityTrade account={account} item={deleting} onClose={() => setDeleting(null)} />
      <UndoGroupDialog target={undo} onClose={() => setUndo(null)} />
    </>
  )
  return { menu, dialogs }
}

function DeleteActivityTrade({ account, item, onClose }: { account: Account; item: ActivityItem | null; onClose(): void }) {
  const online = useOnline()
  const remove = useApiMutation({
    mutationFn: (id: string) => api.positionEvents.remove(id),
    success: 'Trade deleted. Later history was replayed.',
    toastError: false,
    onSuccess: () => onClose(),
  })
  return (
    <ConfirmDialog
      open={item !== null}
      onOpenChange={(o) => {
        if (!o) {
          remove.reset()
          onClose()
        }
      }}
      title={item ? `Delete this ${activityLabel(item.type).toLowerCase()}?` : 'Delete trade'}
      description={`Quantities, cash, and values in ${account.name} replay from that date. If a later sale needs these units, nothing is deleted.`}
      confirmLabel="Delete trade"
      pending={remove.isPending}
      confirmDisabled={!online}
      onConfirm={() => item && remove.mutate(item.id)}
    >
      {item ? (
        <p className="text-sm text-muted">
          {itemName(item)}
          {item.quantity ? (
            <>
              {' · '}
              <Quantity value={item.quantity} /> units
            </>
          ) : null}
          {' · '}
          <DateText value={item.date} />
        </p>
      ) : null}
      <WorkflowProblem error={remove.error} className="mt-3" causes={['A later sale, transfer, or corporate action needs the units this event added. Correct or remove that first.']} />
    </ConfirmDialog>
  )
}
