/**
 * Reads a retained snapshot's `content` defensively. The Go server writes the
 * `wealthboard-estate-summary` v1 document; older or mock snapshots may carry the live workspace
 * shape instead (directives plus allocations). Both normalise to one printable model. Values are
 * copied as recorded; nothing is re-valued.
 */
import type { EstateSnapshot } from '@/api/types'
import { calendarDate } from './model'

export interface SnapshotAllocation {
  id: string
  beneficiaryId: string
  tier: 'primary' | 'contingent'
  allocationBps: number
  notes: string | null
}

export interface SnapshotBeneficiary {
  id: string
  kind: string
  name: string
  relationship: string | null
  contactSummary: string | null
  notes: string | null
  archived: boolean
}

export interface SnapshotAsset {
  id: string
  name: string
  categoryName: string | null
  currency: string
  valueMinor: string | null
  accountReference: string | null
  archived: boolean
  directive: {
    isIncluded: boolean
    ownershipShareBps: number
    transferContext: string
    distributionMethod: string
    documentReference: string | null
    notes: string | null
    reviewedAt: string | null
  } | null
  allocations: SnapshotAllocation[]
}

export interface SnapshotLiability {
  id: string
  name: string
  currency: string
  valueMinor: string | null
}

export interface SnapshotDocument {
  id: string
  version: number
  title: string
  contentHash: string
  generatedAt: string
  valueAsOfDate: string
  baseCurrency: string
  ownerDisplayName: string
  jurisdiction: string | null
  lastReviewedDate: string | null
  reviewReminderDate: string | null
  beneficiaries: SnapshotBeneficiary[]
  assets: SnapshotAsset[]
  liabilities: SnapshotLiability[]
  residuary: SnapshotAllocation[]
  reviewItems: { code: string; message: string; severity: string; accountId: string | null }[]
  accountsWarning: string | null
  disclaimer: string
}

export const DEFAULT_DISCLAIMER =
  'This Estate Planning Summary is a planning record, not a legally executed will. It does not transfer ownership or replace locally valid legal documents and provider designations.'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const optStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const int = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isInteger(v) ? v : fallback)
const minor = (v: unknown): string | null => (typeof v === 'string' && /^-?\d+$/.test(v) ? v : null)
const tier = (v: unknown): 'primary' | 'contingent' => (v === 'contingent' ? 'contingent' : 'primary')

function allocation(v: unknown): SnapshotAllocation {
  const a = obj(v)
  return { id: str(a.id), beneficiaryId: str(a.beneficiaryId), tier: tier(a.tier), allocationBps: int(a.allocationBps), notes: optStr(a.notes) }
}

function directive(v: unknown): SnapshotAsset['directive'] {
  if (!v || typeof v !== 'object') return null
  const d = obj(v)
  return {
    isIncluded: d.isIncluded !== false,
    ownershipShareBps: int(d.ownershipShareBps, 10_000),
    transferContext: str(d.transferContext, 'unknown'),
    distributionMethod: str(d.distributionMethod, 'undecided'),
    documentReference: optStr(d.documentReference),
    notes: optStr(d.notes),
    reviewedAt: optStr(d.reviewedAt),
  }
}

/** Live-workspace-shaped content: directives carry the account fields; allocations link by directiveId. */
function fromWorkspaceShape(c: Obj, base: string): Pick<SnapshotDocument, 'assets' | 'liabilities'> {
  const allocations = list(c.allocations).map((v) => ({ directiveId: str(obj(v).directiveId), ...allocation(v) }))
  const directives = list(c.directives).map(obj)
  const assets: SnapshotAsset[] = []
  const liabilities: SnapshotLiability[] = []
  for (const d of directives) {
    if (d.isLiability === true) {
      liabilities.push({ id: str(d.accountId), name: str(d.accountName, 'Liability'), currency: str(d.currency, base), valueMinor: minor(d.currentValueMinor) })
      continue
    }
    assets.push({
      id: str(d.accountId),
      name: str(d.accountName, 'Asset'),
      categoryName: null,
      currency: str(d.currency, base),
      valueMinor: minor(d.currentValueMinor),
      accountReference: null,
      archived: !!optStr(d.accountArchivedAt),
      directive: directive(d),
      allocations: allocations.filter((a) => a.directiveId === str(d.id)).map(({ directiveId: _d, ...a }) => a),
    })
  }
  return { assets, liabilities }
}

export function normalizeSnapshot(snapshot: EstateSnapshot): SnapshotDocument {
  const c = obj(snapshot.content)
  const base = str(c.baseCurrency, snapshot.baseCurrency)
  const plan = obj(c.plan)
  const isSummary = Array.isArray(c.assets)
  const { assets, liabilities } = isSummary
    ? {
        assets: list(c.assets).map((v): SnapshotAsset => {
          const a = obj(v)
          return {
            id: str(a.id),
            name: str(a.name, 'Asset'),
            categoryName: optStr(a.categoryName),
            currency: str(a.currency, base),
            valueMinor: minor(a.currentValueMinor) ?? minor(a.valueMinor),
            accountReference: optStr(a.accountReference),
            archived: !!optStr(a.archivedAt),
            directive: directive(a.directive),
            allocations: list(a.allocations).map(allocation),
          }
        }),
        liabilities: list(c.liabilities).map((v): SnapshotLiability => {
          const l = obj(v)
          return { id: str(l.id), name: str(l.name, 'Liability'), currency: str(l.currency, base), valueMinor: minor(l.valueMinor) ?? minor(l.currentValueMinor) }
        }),
      }
    : fromWorkspaceShape(c, base)

  return {
    id: snapshot.id,
    version: snapshot.version,
    title: str(plan.title, snapshot.title) || snapshot.title,
    contentHash: snapshot.contentHash,
    generatedAt: str(c.generatedAt, snapshot.generatedAt) || snapshot.generatedAt,
    valueAsOfDate: calendarDate(str(c.valueAsOfDate) || snapshot.valueAsOfDate),
    baseCurrency: base,
    ownerDisplayName: str(c.ownerDisplayName),
    jurisdiction: optStr(plan.jurisdiction),
    lastReviewedDate: optStr(plan.lastReviewedDate),
    reviewReminderDate: optStr(plan.reviewReminderDate),
    beneficiaries: list(c.beneficiaries).map((v) => {
      const b = obj(v)
      return {
        id: str(b.id),
        kind: str(b.kind, 'person'),
        name: str(b.name, 'Unnamed beneficiary'),
        relationship: optStr(b.relationship),
        contactSummary: optStr(b.contactSummary),
        notes: optStr(b.notes),
        archived: !!optStr(b.archivedAt),
      }
    }),
    assets,
    liabilities,
    residuary: list(c.residuaryAllocations).map(allocation),
    reviewItems: list(c.reviewItems).map((v) => {
      const r = obj(v)
      return { code: str(r.code), message: str(r.message), severity: str(r.severity, 'warning'), accountId: optStr(r.accountId) }
    }),
    accountsWarning: optStr(c.accountsWarning) ?? optStr(c.currentValuesWarning),
    disclaimer: optStr(c.disclaimer) ?? DEFAULT_DISCLAIMER,
  }
}
