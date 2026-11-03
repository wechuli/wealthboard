/** Header actions for an account: only the actions valid for its mode, plus a secondary "More" menu. */
import {
  Archive,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BadgePercent,
  ChevronDown,
  Coins,
  HandCoins,
  Landmark,
  MoreHorizontal,
  Pencil,
  Receipt,
  Scale,
  Flag,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { Account } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu'
import { useRecorder, type RecordAction } from '@/features/recording/recorder'
import { ADVANCED_META, AdvancedSheets, CORPORATE_KINDS, useAdvancedParams } from './advanced'
import { ArchiveDialog, DeleteDialog, EditAccountSheet } from './manage'

export type Variant = 'value' | 'positions' | 'liability'

export function useAccountDialogs() {
  const [dialog, setDialog] = useState<'edit' | 'archive' | 'delete' | null>(null)
  const [editKey, setEditKey] = useState(0)
  const openEdit = () => {
    setEditKey((k) => k + 1)
    setDialog('edit')
  }
  return { dialog, setDialog, editKey, openEdit }
}

export function AccountActions({
  account,
  variant,
  valuationLed,
  dialogs,
}: {
  account: Account
  variant: Variant
  valuationLed: boolean
  dialogs: ReturnType<typeof useAccountDialogs>
}) {
  const recorder = useRecorder()
  const navigate = useNavigate()
  const advanced = useAdvancedParams()
  const [params, setParams] = useSearchParams()
  const { dialog, setDialog, editKey, openEdit } = dialogs
  // `?edit=1` (from legacy /accounts/:id/edit links) opens the edit sheet; closing removes it.
  const editFromLink = params.get('edit') === '1'
  const setEditOpen = (o: boolean) => {
    setDialog(o ? 'edit' : null)
    if (!o && editFromLink)
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('edit')
          return next
        },
        { replace: true },
      )
  }
  const rec = (action: RecordAction) => recorder.open({ action, accountId: account.id })
  const archived = !!account.archivedAt

  const more = (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button icon={<MoreHorizontal size={16} aria-hidden />} aria-label="More account actions">
          <span className="max-sm:sr-only">More</span>
        </Button>
      </MenuTrigger>
      <MenuContent>
        {variant === 'positions' && !archived ? (
          <>
            <MenuLabel>Holdings</MenuLabel>
            <MenuItem icon={<Flag />} onSelect={() => advanced.newTrade('opening_position')}>
              Add opening position
            </MenuItem>
            <MenuItem icon={<Scale />} onSelect={() => advanced.newTrade('quantity_adjustment')}>
              Adjust quantity
            </MenuItem>
            <MenuItem icon={<ADVANCED_META.reconcile.icon />} onSelect={() => advanced.open('reconcile')}>
              {ADVANCED_META.reconcile.label}
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Corporate actions</MenuLabel>
            {CORPORATE_KINDS.map((a) => {
              const M = ADVANCED_META[a]
              return (
                <MenuItem key={a} icon={<M.icon />} onSelect={() => advanced.open(a)}>
                  {M.label}
                </MenuItem>
              )
            })}
            <MenuSeparator />
          </>
        ) : null}
        {!archived ? (
          <MenuItem icon={<Upload />} onSelect={() => navigate(`/accounts/${account.id}/import`)}>
            Import history
          </MenuItem>
        ) : null}
        {variant === 'value' && !archived ? (
          <MenuItem icon={<ADVANCED_META.convert.icon />} onSelect={() => advanced.open('convert')}>
            {ADVANCED_META.convert.label}
          </MenuItem>
        ) : null}
        <MenuItem icon={<Pencil />} onSelect={openEdit}>
          Edit details
        </MenuItem>
        <MenuSeparator />
        {!archived ? (
          <MenuItem icon={<Archive />} onSelect={() => setDialog('archive')}>
            Archive
          </MenuItem>
        ) : null}
        <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setDialog('delete')}>
          Delete
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  )

  const cashMenu = (label: string, primary: boolean, items: { action: RecordAction; label: string; icon: React.ReactNode }[]) => (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button variant={primary ? 'primary' : 'secondary'}>
          {label}
          <ChevronDown size={15} aria-hidden />
        </Button>
      </MenuTrigger>
      <MenuContent align="start">
        {items.map((i) => (
          <MenuItem key={i.action} icon={i.icon} onSelect={() => rec(i.action)}>
            {i.label}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  )

  let primary: React.ReactNode = null
  if (!archived) {
    if (variant === 'liability') {
      primary = (
        <>
          <Button variant="primary" icon={<HandCoins size={16} aria-hidden />} onClick={() => rec('payment')}>
            Record payment
          </Button>
          <Button icon={<Wallet size={16} aria-hidden />} onClick={() => rec('increase')}>
            Record increase
          </Button>
        </>
      )
    } else if (variant === 'positions') {
      primary = (
        <>
          <Button variant="primary" icon={<TrendingUp size={16} aria-hidden />} onClick={() => rec('buy')}>
            Buy
          </Button>
          <Button icon={<TrendingDown size={16} aria-hidden />} onClick={() => rec('sell')}>
            Sell
          </Button>
          <Button icon={<Tag size={16} aria-hidden />} onClick={() => rec('price')}>
            Update price
          </Button>
          {cashMenu('Cash', false, [
            { action: 'deposit', label: 'Deposit cash', icon: <ArrowDownLeft /> },
            { action: 'withdrawal', label: 'Withdraw cash', icon: <ArrowUpRight /> },
            { action: 'dividend', label: 'Dividend', icon: <Coins /> },
            { action: 'interest', label: 'Interest', icon: <BadgePercent /> },
            { action: 'fee', label: 'Fee', icon: <Receipt /> },
          ])}
        </>
      )
    } else {
      const recordItems = [
        { action: 'deposit' as const, label: 'Deposit', icon: <ArrowDownLeft /> },
        { action: 'withdrawal' as const, label: 'Withdrawal', icon: <ArrowUpRight /> },
        { action: 'interest' as const, label: 'Interest', icon: <BadgePercent /> },
        { action: 'fee' as const, label: 'Fee', icon: <Receipt /> },
        { action: 'transfer' as const, label: 'Transfer', icon: <ArrowLeftRight /> },
      ]
      const update = (
        <Button variant={valuationLed ? 'primary' : 'secondary'} icon={<Landmark size={16} aria-hidden />} onClick={() => rec('valuation')}>
          Update value
        </Button>
      )
      primary = valuationLed ? (
        <>
          {update}
          {cashMenu('Record', false, recordItems)}
        </>
      ) : (
        <>
          {cashMenu('Record', true, recordItems)}
          {update}
        </>
      )
    }
  }

  return (
    <>
      {primary}
      {more}
      <EditAccountSheet key={editKey} account={account} open={dialog === 'edit' || editFromLink} onOpenChange={setEditOpen} />
      <ArchiveDialog account={account} open={dialog === 'archive'} onOpenChange={(o) => setDialog(o ? 'archive' : null)} />
      <DeleteDialog account={account} open={dialog === 'delete'} onOpenChange={(o) => setDialog(o ? 'delete' : null)} />
      <AdvancedSheets account={account} />
    </>
  )
}
