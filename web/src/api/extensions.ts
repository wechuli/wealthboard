/**
 * Read models added to the API for the redesigned client (summaries, attention, flows, income,
 * net-worth stats, comparison, account extras, instrument holdings, cross-account activity).
 * The shapes come from the generated OpenAPI types, so the client and server cannot drift.
 */
import type { components, paths } from './schema'

type S = components['schemas']

export type Freshness = S['FreshnessStatus']
export type AccountSummaryExt = S['AccountSummary']
export type AttentionItem = S['AttentionItem']
export type AttentionKind = AttentionItem['kind']
export type AttentionSummary = S['AttentionSummary']
export type MonthlyFlowPoint = S['MonthlyFlowPoint']
export type FlowsReport = S['FlowsReport']
export type IncomeReport = S['IncomeReport']
export type NetWorthStats = S['NetWorthStats']
export type AccountComparisonRow = S['AccountComparisonRow']
export type ReturnStatus = AccountComparisonRow['returnStatus']
export type AccountComparison = S['AccountComparison']
export type AccountExtras = S['AccountExtras']
export type InstrumentHoldings = S['InstrumentHoldings']

/** Filters for GET /activity. */
export type ActivityQuery = NonNullable<paths['/activity']['get']['parameters']['query']>
