/**
 * Advanced investment workflows: convert to positions, reconcile, corporate actions, and the full trade editor.
 * The URL is the source of truth (`?action=…`, `?editTrade=<id>`), so legacy links and the browser's back
 * button open the same sheet; closing a sheet removes its parameters.
 */
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { Account } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Dialog'
import { Notice } from '@/components/ui/Notice'
import { isPositions } from '@/features/accounts/model'
import { useAccountAnalytics } from '@/lib/queries'
import { ConvertSheet } from './ConvertSheet'
import { CorporateActionSheet, CorporateChooserSheet } from './CorporateActionSheet'
import { ADVANCED_META, type AdvancedAction, type CorporateKind } from './advanced-meta'
import { ReconcileSheet } from './ReconcileSheet'
import { TradeSheet, type TradeType } from './TradeSheet'

export { ADVANCED_META, CORPORATE_KINDS, type AdvancedAction, type CorporateKind } from './advanced-meta'

const ACTIONS = new Set<string>(['convert', 'reconcile', 'corporate', 'trade', 'split', 'spinoff', 'merger', 'drip', 'inkind'])
const TRADE_TYPES = new Set<string>(['opening_position', 'buy', 'sell', 'quantity_adjustment'])
const OWNED_PARAMS = ['action', 'trade', 'instrument', 'editTrade']

/** Reads and writes the sheet parameters on `/accounts/:accountId`. */
export function useAdvancedParams() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('action')
  const action = raw && ACTIONS.has(raw) ? (raw as AdvancedAction) : null
  const rawTrade = params.get('trade')
  const tradeType: TradeType = rawTrade && TRADE_TYPES.has(rawTrade) ? (rawTrade as TradeType) : 'opening_position'
  const update = (apply: (p: URLSearchParams) => void) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of OWNED_PARAMS) next.delete(k)
        apply(next)
        return next
      },
      { replace: true },
    )
  return {
    action,
    tradeType,
    instrumentId: params.get('instrument'),
    editTrade: params.get('editTrade'),
    open: (a: AdvancedAction) => update((p) => p.set('action', a)),
    newTrade: (type: TradeType, instrumentId?: string) =>
      update((p) => {
        p.set('action', 'trade')
        p.set('trade', type)
        if (instrumentId) p.set('instrument', instrumentId)
      }),
    editTradeById: (id: string) => update((p) => p.set('editTrade', id)),
    close: () => update(() => {}),
  }
}

type Current = { kind: 'edit'; eventId: string } | { kind: 'trade'; type: TradeType; instrumentId?: string } | { kind: Exclude<AdvancedAction, 'trade'> }

function blockedReason(current: Current, account: Account): string | null {
  if (account.archivedAt) return `${account.name} is archived. Restore it from the notice at the top of the page before recording or correcting activity.`
  if (current.kind === 'convert') {
    if (account.isLiability) return 'Liabilities stay value-tracked. Only investment accounts can carry units and prices.'
    if (isPositions(account)) return `${account.name} already tracks units and prices. Record trades, prices, and corporate actions instead.`
    return null
  }
  if (!isPositions(account))
    return current.kind === 'reconcile'
      ? `${account.name} is value-tracked, so its value is whatever you last recorded. Use Update value to match a statement, or convert it to position tracking first.`
      : `${account.name} is value-tracked. Holdings, trades, and corporate actions need a position-tracked account. Convert it to position tracking first.`
  return null
}

const titleOf = (c: Current) => (c.kind === 'edit' ? 'Edit trade' : ADVANCED_META[c.kind].label)

/** Mounts the sheet named by the URL. Keeps the last sheet rendered while it animates closed. */
export function AdvancedSheets({ account }: { account: Account }) {
  const p = useAdvancedParams()
  const analytics = useAccountAnalytics(account.id)
  const positions = analytics.data?.positionSummary?.positions ?? []
  const positionsReady = !analytics.isPending
  const current: Current | null = p.editTrade
    ? { kind: 'edit', eventId: p.editTrade }
    : p.action === 'trade'
      ? { kind: 'trade', type: p.tradeType, instrumentId: p.instrumentId ?? undefined }
      : p.action
        ? { kind: p.action }
        : null
  const currentKey = current ? JSON.stringify(current) : null
  const [shown, setShown] = useState<{ key: string; current: Current; session: number } | null>(null)
  if (current && currentKey && currentKey !== shown?.key) setShown({ key: currentKey, current, session: (shown?.session ?? 0) + 1 })
  if (!shown) return null

  const open = currentKey === shown.key
  const onOpenChange = (o: boolean) => {
    if (!o) p.close()
  }
  const c = shown.current
  const k = shown.session
  const blocked = blockedReason(c, account)
  if (blocked)
    return (
      <Sheet
        key={k}
        open={open}
        onOpenChange={onOpenChange}
        title={titleOf(c)}
        footer={
          <Button variant="primary" onClick={p.close}>
            Close
          </Button>
        }
      >
        <Notice tone="info" title="Not available for this account">
          {blocked}
        </Notice>
      </Sheet>
    )
  const common = { account, positions, open, onOpenChange }
  switch (c.kind) {
    case 'edit':
      return <TradeSheet key={k} {...common} positionsReady={positionsReady} eventId={c.eventId} />
    case 'trade':
      return <TradeSheet key={k} {...common} positionsReady={positionsReady} initialType={c.type} initialInstrumentId={c.instrumentId} />
    case 'convert':
      return <ConvertSheet key={k} {...common} />
    case 'reconcile':
      return <ReconcileSheet key={k} {...common} />
    case 'corporate':
      return <CorporateChooserSheet key={k} {...common} onChoose={(kind: CorporateKind) => p.open(kind)} />
    default:
      return <CorporateActionSheet key={k} {...common} positionsReady={positionsReady} kind={c.kind} onBack={() => p.open('corporate')} />
  }
}
