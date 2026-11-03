/**
 * Pure estate-planning helpers. Percentages are exact integer basis points (10,000 = 100%), so the
 * only arithmetic here is integer addition of planning inputs. Money values are never derived:
 * the UI shows the account values the server reports and nothing else.
 */
import type { Account, Beneficiary, EstateAllocation, EstateDirective, EstateWorkspace, ResiduaryAllocation } from '@/api/types'
import { formatBps, minorSign, percentToBps } from '@/lib/money'

export const FULL_BPS = 10_000

export type Tier = 'primary' | 'contingent'
export type TransferContext = EstateDirective['transferContext']
export type DistributionMethod = EstateDirective['distributionMethod']
export type BeneficiaryKind = Beneficiary['kind']

export const TRANSFER_CONTEXTS: { value: TransferContext; label: string }[] = [
  { value: 'estate', label: 'Passes through the estate' },
  { value: 'joint_survivorship', label: 'Joint ownership / survivorship' },
  { value: 'provider_designation', label: 'Provider beneficiary designation' },
  { value: 'trust_entity', label: 'Held by a trust or entity' },
  { value: 'unknown', label: 'Not confirmed' },
]

export const DISTRIBUTION_METHODS: { value: DistributionMethod; label: string }[] = [
  { value: 'transfer_asset', label: 'Transfer the asset' },
  { value: 'sell_and_divide', label: 'Sell and divide proceeds' },
  { value: 'cash_equivalent', label: 'Provide cash equivalent' },
  { value: 'undecided', label: 'Not decided' },
]

export const BENEFICIARY_KINDS: { value: BeneficiaryKind; label: string }[] = [
  { value: 'person', label: 'Person' },
  { value: 'organization', label: 'Organization' },
  { value: 'trust', label: 'Trust' },
]

export const TIER_LABEL: Record<Tier, string> = { primary: 'Primary', contingent: 'Contingent' }

export function labelOf<T extends string>(options: { value: T; label: string }[], value: string | null | undefined, fallback = 'Not recorded'): string {
  return options.find((o) => o.value === value)?.label ?? (value ? value.replaceAll('_', ' ') : fallback)
}

// ---- dates ------------------------------------------------------------------------

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Estate dates are calendar dates the server stores at midnight UTC and may echo back with a local
 * offset ("2026-10-01T03:00:00+03:00"). Normalising through UTC recovers the date that was entered.
 */
export function calendarDate(value: string | null | undefined): string {
  if (!value) return ''
  if (DATE_ONLY.test(value)) return value
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? value.slice(0, 10) : new Date(ms).toISOString().slice(0, 10)
}

// ---- percentages ------------------------------------------------------------------

export type PercentResult = { ok: true; bps: number } | { ok: false; message: string }

/** Parses a percentage typed by the user into basis points within [min, 100%]. */
export function parsePercent(input: string, { min = 1, label = 'percentage' }: { min?: number; label?: string } = {}): PercentResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, message: `Enter a ${label}` }
  let bps: number
  try {
    bps = percentToBps(trimmed)
  } catch (error) {
    const message = error instanceof Error && /decimal places/.test(error.message) ? 'Use at most two decimal places' : `Enter a ${label} such as 50 or 33.33`
    return { ok: false, message }
  }
  if (bps < min) return { ok: false, message: `Enter a ${label} above 0%` }
  if (bps > FULL_BPS) return { ok: false, message: `A ${label} can't be more than 100%` }
  return { ok: true, bps }
}

/** Basis points as an editable percent string without a % sign: 3333 → "33.33". */
export function bpsToInput(bps: number): string {
  return formatBps(bps).replace('%', '').replace(/,/g, '')
}

type TierRow = { beneficiaryId: string; tier: Tier; allocationBps: number }

export function tierTotal(rows: readonly TierRow[], tier: Tier): number {
  return rows.reduce((sum, r) => (r.tier === tier ? sum + r.allocationBps : sum), 0)
}

/**
 * The tier total after saving `bps` for a beneficiary. Saving is an upsert keyed by beneficiary
 * and tier, so an existing share for the same beneficiary is replaced rather than added to.
 */
export function projectedTierTotal(rows: readonly TierRow[], tier: Tier, beneficiaryId: string, bps: number): number {
  return rows.reduce((sum, r) => (r.tier === tier && r.beneficiaryId !== beneficiaryId ? sum + r.allocationBps : sum), 0) + bps
}

export type TierState =
  | { kind: 'empty'; totalBps: 0; remainingBps: number }
  | { kind: 'under'; totalBps: number; remainingBps: number }
  | { kind: 'complete'; totalBps: number; remainingBps: 0 }
  | { kind: 'over'; totalBps: number; overBps: number }

export function tierState(totalBps: number): TierState {
  if (totalBps <= 0) return { kind: 'empty', totalBps: 0, remainingBps: FULL_BPS }
  if (totalBps === FULL_BPS) return { kind: 'complete', totalBps, remainingBps: 0 }
  if (totalBps > FULL_BPS) return { kind: 'over', totalBps, overBps: totalBps - FULL_BPS }
  return { kind: 'under', totalBps, remainingBps: FULL_BPS - totalBps }
}

/** Plain-language tier status: "100% · complete", "60% · 40% remaining", "110% · 10% over". */
export function describeTier(state: TierState): string {
  switch (state.kind) {
    case 'empty':
      return 'Nothing allocated yet'
    case 'complete':
      return '100% allocated'
    case 'under':
      return `${formatBps(state.totalBps)} allocated · ${formatBps(state.remainingBps)} remaining`
    case 'over':
      return `${formatBps(state.totalBps)} allocated · ${formatBps(state.overBps)} over`
  }
}

// ---- workspace view ----------------------------------------------------------------

export interface AssetRow {
  account: Account
  directive: EstateDirective | null
  /** Inclusion defaults to the account's net-worth setting until a directive is saved. */
  isIncluded: boolean
  allocations: EstateAllocation[]
  primaryBps: number
  contingentBps: number
}

export interface EstateView {
  workspace: EstateWorkspace
  beneficiaries: Beneficiary[]
  activeBeneficiaries: Beneficiary[]
  beneficiaryById: Map<string, Beneficiary>
  assets: AssetRow[]
  liabilities: Account[]
  residuary: ResiduaryAllocation[]
  residuaryPrimaryBps: number
  residuaryContingentBps: number
}

export function buildEstateView(workspace: EstateWorkspace, accounts: readonly Account[]): EstateView {
  const beneficiaryById = new Map(workspace.beneficiaries.map((b) => [b.id, b]))
  const active = accounts.filter((a) => !a.archivedAt)
  const assets = active
    .filter((a) => !a.isLiability)
    .map((account): AssetRow => {
      const directive = workspace.directives.find((d) => d.accountId === account.id) ?? null
      const allocations = directive ? workspace.allocations.filter((x) => x.directiveId === directive.id) : []
      return {
        account,
        directive,
        isIncluded: directive?.isIncluded ?? account.isIncludedInNetWorth,
        allocations,
        primaryBps: tierTotal(allocations, 'primary'),
        contingentBps: tierTotal(allocations, 'contingent'),
      }
    })
  return {
    workspace,
    beneficiaries: workspace.beneficiaries,
    activeBeneficiaries: workspace.beneficiaries.filter((b) => !b.archivedAt),
    beneficiaryById,
    assets,
    liabilities: active.filter((a) => a.isLiability),
    residuary: workspace.residuaryAllocations,
    residuaryPrimaryBps: tierTotal(workspace.residuaryAllocations, 'primary'),
    residuaryContingentBps: tierTotal(workspace.residuaryAllocations, 'contingent'),
  }
}

export type AssetStatus = 'excluded' | 'unconfigured' | 'incomplete' | 'covered' | 'complete'

/** Where an asset stands. "covered" means a complete primary residue fills the specific gap. */
export function assetStatus(row: AssetRow, residuaryPrimaryBps: number): AssetStatus {
  if (!row.isIncluded) return 'excluded'
  if (!row.directive) return 'unconfigured'
  const contingentOk = row.contingentBps === 0 || row.contingentBps === FULL_BPS
  if (row.primaryBps === FULL_BPS && contingentOk) return 'complete'
  if (row.primaryBps < FULL_BPS && residuaryPrimaryBps === FULL_BPS && contingentOk) return 'covered'
  return 'incomplete'
}

// ---- review checklist --------------------------------------------------------------

export interface ReviewItem {
  code: string
  message: string
  severity: 'blocking' | 'warning'
  accountId?: string
}

/** Deterministic planning checks from percentages and settings only (no money arithmetic). */
export function reviewItems(view: EstateView, today: string): ReviewItem[] {
  const items: ReviewItem[] = []
  const { workspace, beneficiaryById, residuaryPrimaryBps, residuaryContingentBps } = view
  const archived = (id: string) => !!beneficiaryById.get(id)?.archivedAt

  if (view.activeBeneficiaries.length === 0) items.push({ code: 'no-beneficiaries', message: 'Add at least one active beneficiary.', severity: 'blocking' })
  if (view.residuary.some((r) => archived(r.beneficiaryId)))
    items.push({ code: 'archived-residual-beneficiary', message: 'A residual allocation names an archived beneficiary.', severity: 'blocking' })
  if (residuaryPrimaryBps > 0 && residuaryPrimaryBps !== FULL_BPS)
    items.push({ code: 'residue-incomplete', message: `Primary residual allocations total ${formatBps(residuaryPrimaryBps)}; they must total 100% when used.`, severity: 'blocking' })
  if (residuaryContingentBps > 0 && residuaryContingentBps !== FULL_BPS)
    items.push({ code: 'residue-contingent-incomplete', message: `Contingent residual allocations total ${formatBps(residuaryContingentBps)}; they must total 100% when used.`, severity: 'blocking' })

  for (const row of view.assets) {
    if (!row.isIncluded) continue
    const name = row.account.name
    const accountId = row.account.id
    if (!row.directive) {
      items.push({ code: 'asset-unconfigured', message: `Describe how ${name} is held and distributed.`, severity: 'blocking', accountId })
      continue
    }
    if (row.primaryBps < FULL_BPS && residuaryPrimaryBps !== FULL_BPS)
      items.push({
        code: 'allocation-incomplete',
        message: `${name} has ${formatBps(FULL_BPS - row.primaryBps)} without a primary or residual beneficiary.`,
        severity: 'blocking',
        accountId,
      })
    if (row.primaryBps > FULL_BPS) items.push({ code: 'allocation-over', message: `Primary allocations for ${name} exceed 100%.`, severity: 'blocking', accountId })
    if (row.contingentBps > 0 && row.contingentBps !== FULL_BPS)
      items.push({ code: 'contingent-incomplete', message: `Contingent allocations for ${name} total ${formatBps(row.contingentBps)}; they must total 100% when used.`, severity: 'blocking', accountId })
    if (row.allocations.some((a) => archived(a.beneficiaryId)))
      items.push({ code: 'archived-beneficiary', message: `${name} names an archived beneficiary.`, severity: 'blocking', accountId })
    if (row.directive.transferContext === 'unknown') items.push({ code: 'transfer-context-unknown', message: `Confirm how ${name} is legally held or designated.`, severity: 'warning', accountId })
    if (row.directive.distributionMethod === 'undecided') items.push({ code: 'distribution-undecided', message: `Choose how ${name} should be distributed.`, severity: 'warning', accountId })
    if (row.directive.distributionMethod === 'transfer_asset' && row.allocations.filter((a) => a.tier === 'primary').length > 1)
      items.push({ code: 'shared-title-review', message: `${name} is set to transfer to several beneficiaries; confirm shared title is practical.`, severity: 'warning', accountId })
    if (minorSign(row.account.currentValueMinor) === 0) items.push({ code: 'zero-value', message: `${name} currently has a zero value.`, severity: 'warning', accountId })
  }

  if (view.liabilities.length > 0)
    items.push({ code: 'liabilities-review', message: 'Review how debts, secured claims, taxes, and estate expenses may affect actual gifts.', severity: 'warning' })
  const plan = workspace.plan
  if (!plan?.lastReviewedDate) items.push({ code: 'plan-not-reviewed', message: 'Record when you last reviewed this plan.', severity: 'warning' })
  if (plan?.reviewReminderDate && calendarDate(plan.reviewReminderDate) <= today)
    items.push({ code: 'review-due', message: 'Your planned review date has arrived. Walk through the plan and record a new review date.', severity: 'warning' })
  return items
}

export const MATH_CODES = new Set([
  'no-beneficiaries',
  'asset-unconfigured',
  'allocation-incomplete',
  'allocation-over',
  'contingent-incomplete',
  'residue-incomplete',
  'residue-contingent-incomplete',
  'archived-beneficiary',
  'archived-residual-beneficiary',
])

export function isMathematicallyComplete(items: readonly ReviewItem[]): boolean {
  return !items.some((i) => i.severity === 'blocking' && MATH_CODES.has(i.code))
}

/** Where each beneficiary is named, by tier (percentages only). */
export interface BeneficiaryRole {
  beneficiary: Beneficiary
  primary: { accountName: string; bps: number }[]
  contingent: { accountName: string; bps: number }[]
  residuaryPrimaryBps: number
  residuaryContingentBps: number
}

export function beneficiaryRoles(view: EstateView): BeneficiaryRole[] {
  return view.beneficiaries.map((beneficiary) => {
    const role: BeneficiaryRole = { beneficiary, primary: [], contingent: [], residuaryPrimaryBps: 0, residuaryContingentBps: 0 }
    for (const row of view.assets) {
      if (!row.isIncluded) continue
      for (const a of row.allocations) if (a.beneficiaryId === beneficiary.id) role[a.tier].push({ accountName: row.account.name, bps: a.allocationBps })
    }
    for (const r of view.residuary) {
      if (r.beneficiaryId !== beneficiary.id) continue
      if (r.tier === 'primary') role.residuaryPrimaryBps += r.allocationBps
      else role.residuaryContingentBps += r.allocationBps
    }
    return role
  })
}
