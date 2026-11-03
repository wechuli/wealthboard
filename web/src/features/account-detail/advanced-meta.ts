import { ArrowRightLeft, ClipboardCheck, Flag, GitFork, Layers, Merge, Repeat, Split, type LucideIcon } from 'lucide-react'

export type CorporateKind = 'split' | 'spinoff' | 'merger' | 'drip' | 'inkind'
export type AdvancedAction = 'convert' | 'reconcile' | 'corporate' | CorporateKind | 'trade'

export const ADVANCED_META: Record<AdvancedAction, { label: string; icon: LucideIcon; description: string }> = {
  convert: { label: 'Convert to position tracking', icon: Layers, description: 'Replace one value with explicit cash and holdings.' },
  reconcile: { label: 'Reconcile to statement', icon: ClipboardCheck, description: 'Record a broker statement total. Nothing else changes.' },
  corporate: { label: 'Corporate actions', icon: Split, description: 'Splits, spin-offs, mergers, reinvestments, and transfers.' },
  split: { label: 'Stock split', icon: Split, description: 'Quantity changes by a ratio. Cash is unchanged.' },
  spinoff: { label: 'Spin-off', icon: GitFork, description: 'Receive shares of a new company alongside the original.' },
  merger: { label: 'Merger', icon: Merge, description: 'Exchange one holding for shares of the acquirer.' },
  drip: { label: 'Dividend reinvestment', icon: Repeat, description: 'A dividend and the units it bought, recorded together.' },
  inkind: { label: 'In-kind transfer', icon: ArrowRightLeft, description: 'Move units to another account without selling.' },
  trade: { label: 'Record position activity', icon: Flag, description: 'Opening positions, quantity adjustments, buys, and sells.' },
}

export const CORPORATE_KINDS: CorporateKind[] = ['split', 'spinoff', 'merger', 'drip', 'inkind']

/** Human name of the corporate action a grouped activity row belongs to. */
export function groupActionLabel(type: string, kind?: string): string {
  switch (type) {
    case 'split':
      return 'stock split'
    case 'spinoff':
      return 'spin-off'
    case 'merger_in':
    case 'merger_out':
      return 'merger'
    case 'transfer_in':
    case 'transfer_out':
      return 'in-kind transfer'
    case 'buy':
    case 'dividend':
      return 'dividend reinvestment'
    case 'fee':
      return kind === 'transaction' ? 'in-kind transfer' : 'corporate action'
    default:
      return 'corporate action'
  }
}
