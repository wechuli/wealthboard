/**
 * Mock state for estate planning, AI settings, and API keys. Kept separate from the ledger engine:
 * these features don't change balances. Values come from the engine's current account values.
 */
import type { AIRead, APIKeyMetadata, ConnectedApp, Beneficiary, CreatedAPIKey, EstateAllocation, EstateDirective, EstatePlan, EstateSnapshot, EstateWorkspace, ResiduaryAllocation } from '../types'
import { randomId, stableId } from './rng'

export interface SideState {
  plan: EstatePlan | null
  beneficiaries: Beneficiary[]
  directives: Omit<EstateDirective, 'accountName' | 'currency' | 'currentValueMinor' | 'isLiability' | 'accountArchivedAt'>[]
  allocations: EstateAllocation[]
  residuary: ResiduaryAllocation[]
  snapshots: EstateSnapshot[]
  ai: AIRead
  apiKeys: APIKeyMetadata[]
  connectedApps: ConnectedApp[]
}

const stamp = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

export function emptySideState(): SideState {
  const month = new Date().toISOString().slice(0, 7)
  return {
    plan: null,
    beneficiaries: [],
    directives: [],
    allocations: [],
    residuary: [],
    snapshots: [],
    ai: {
      settings: null,
      usage: { billingMonth: month, chargedTokens: 0, remainingTokens: 0, monthlyTokenLimit: 0, successfulRequests: 0, lastUsedAt: null },
      events: [],
      availability: {
        available: false,
        reason: 'Connect an AI provider to convert statements.',
        providerConfigured: false,
        storedCredentialAvailable: false,
        sessionCredentialAccepted: false,
        cooldownUntil: null,
        budgetRemainingTokens: 0,
      },
    },
    apiKeys: [],
    connectedApps: [],
  }
}

/** A fictional estate plan over the demo accounts. */
export function demoSideState(accountIds: { land: string; zimele: string; madison: string; loan: string }): SideState {
  const s = emptySideState()
  const planId = stableId('estate:plan')
  s.plan = { id: planId, title: 'Family estate plan', jurisdiction: 'Kenya', lastReviewedDate: stamp(120), reviewReminderDate: stamp(-245), createdAt: stamp(400), updatedAt: stamp(120) }
  const ben = (key: string, kind: Beneficiary['kind'], name: string, relationship: string): Beneficiary => ({
    id: stableId(`beneficiary:${key}`),
    kind,
    name,
    relationship,
    contactSummary: null,
    notes: null,
    archivedAt: null,
    createdAt: stamp(400),
    updatedAt: stamp(400),
  })
  s.beneficiaries = [ben('spouse', 'person', 'Wanjiru (spouse)', 'Spouse'), ben('child-a', 'person', 'Child A', 'Daughter'), ben('child-b', 'person', 'Child B', 'Son'), ben('trust', 'trust', 'Education trust', 'Family trust')]
  const [spouse, childA, childB, trust] = s.beneficiaries as [Beneficiary, Beneficiary, Beneficiary, Beneficiary]
  const directive = (accountId: string, method: EstateDirective['distributionMethod'], context: EstateDirective['transferContext']) => ({
    id: stableId(`directive:${accountId}`),
    estatePlanId: planId,
    accountId,
    isIncluded: true,
    ownershipShareBps: 10000,
    transferContext: context,
    distributionMethod: method,
    documentReference: null,
    notes: null,
    reviewedAt: stamp(120),
    createdAt: stamp(400),
    updatedAt: stamp(120),
  })
  s.directives = [directive(accountIds.land, 'transfer_asset', 'estate'), directive(accountIds.zimele, 'cash_equivalent', 'provider_designation'), directive(accountIds.madison, 'sell_and_divide', 'estate')]
  const alloc = (directiveId: string, beneficiaryId: string, tier: 'primary' | 'contingent', bps: number): EstateAllocation => ({
    id: randomId(),
    estatePlanId: planId,
    directiveId,
    beneficiaryId,
    tier,
    allocationBps: bps,
    notes: null,
    createdAt: stamp(400),
    updatedAt: stamp(120),
  })
  const [land, zimele, madison] = s.directives.map((d) => ({ id: d.id })) as [{ id: string }, { id: string }, { id: string }]
  s.allocations = [
    alloc(land.id, childA.id, 'primary', 5000),
    alloc(land.id, childB.id, 'primary', 5000),
    alloc(land.id, spouse.id, 'contingent', 10000),
    alloc(zimele.id, spouse.id, 'primary', 10000),
    alloc(madison.id, trust.id, 'primary', 10000),
  ]
  s.residuary = [{ id: randomId(), estatePlanId: planId, beneficiaryId: spouse.id, tier: 'primary', allocationBps: 10000, notes: null, createdAt: stamp(400), updatedAt: stamp(120) }]
  void accountIds.loan
  s.apiKeys = [
    { id: stableId('key:budget'), name: 'Home budget spreadsheet', prefix: 'wbk_v1_7Kq2', scopes: ['portfolio:read'], createdAt: stamp(60), expiresAt: null, lastUsedAt: stamp(2), revokedAt: null },
  ]
  return s
}

export function buildWorkspace(side: SideState, accounts: { id: string; name: string; currency: string; currentValueMinor: string; isLiability: boolean; archivedAt?: string }[], complete: boolean): EstateWorkspace {
  return {
    plan: side.plan,
    beneficiaries: side.beneficiaries,
    directives: side.directives.flatMap((d) => {
      const a = accounts.find((x) => x.id === d.accountId)
      if (!a) return []
      return [{ ...d, accountName: a.name, currency: a.currency, currentValueMinor: a.currentValueMinor, isLiability: a.isLiability, accountArchivedAt: a.archivedAt ?? null }]
    }),
    allocations: side.allocations,
    residuaryAllocations: side.residuary,
    snapshots: side.snapshots.map(({ content: _content, ...meta }) => meta),
    currentValuesComplete: complete,
    currentValuesWarning: complete ? '' : 'Some account values are incomplete, so indicative amounts may be understated.',
  }
}

export function newApiKey(name: string, scopes: APIKeyMetadata['scopes'], expiresAt: string | null | undefined): CreatedAPIKey {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32)
  const prefix = `wbk_v1_${secret.slice(0, 4)}`
  return { id: randomId(), name, prefix, scopes, createdAt: new Date().toISOString(), expiresAt: expiresAt ?? null, lastUsedAt: null, revokedAt: null, token: `${prefix}${secret.slice(4)}` }
}
