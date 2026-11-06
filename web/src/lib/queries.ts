/**
 * Server-state hooks. Every query key is scoped to the signed-in user (['u', userId, ...]) so a
 * previous user's data can never flash. Mutations invalidate the user's cache (the server
 * recomputes totals) and are blocked while offline.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey, type UseQueryOptions } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/api'
import type { ActivityQuery } from '@/api/extensions'
import type { PageQuery } from '@/api/datasource'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { DashboardRange } from '@/api/types'
import { useSession } from './session'
import { isOnline } from './online'

export function useUserKey(): string {
  const { user } = useSession()
  return user?.id ?? 'anonymous'
}

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'>

/** A query scoped to the signed-in user. */
export function useUserQuery<T>(key: readonly unknown[], fn: () => Promise<T>, options: QueryOpts<T> = {}) {
  const { user } = useSession()
  return useQuery<T, Error, T, QueryKey>({
    queryKey: ['u', user?.id ?? 'anonymous', ...key],
    queryFn: fn,
    ...options,
    // Always gate on the session, even when the caller passes its own `enabled`.
    enabled: !!user && (options.enabled ?? true),
  })
}

// ---- reads --------------------------------------------------------------------

export const useDashboard = (range: DashboardRange) => useUserQuery(['dashboard', range], () => api.dashboard.get(range), { placeholderData: (prev) => prev })
export const useAccounts = (archived: 'active' | 'archived' | 'all' = 'active') => useUserQuery(['accounts', archived], () => api.accounts.list(archived))
export const useAccountSummaries = () => useUserQuery(['accounts', 'summaries'], () => api.accounts.summaries())
export const useAccount = (id: string | undefined) => useUserQuery(['account', id], () => api.accounts.get(id!), { enabled: !!id })
export const useAccountAnalytics = (id: string | undefined) => useUserQuery(['account', id, 'analytics'], () => api.accounts.analytics(id!), { enabled: !!id })
export const useAccountExtras = (id: string | undefined) => useUserQuery(['account', id, 'extras'], () => api.accounts.extras(id!), { enabled: !!id })
export const useAccountActivity = (id: string | undefined, q: PageQuery = {}) =>
  useUserQuery(['account', id, 'activity', q], () => api.accounts.activity(id!, q), { enabled: !!id, placeholderData: (prev) => prev })
export const useAccountValuations = (id: string | undefined, q: PageQuery = {}) => useUserQuery(['account', id, 'valuations', q], () => api.accounts.valuations(id!, q), { enabled: !!id })
export const useAccountTransactions = (id: string | undefined, q: PageQuery = {}) => useUserQuery(['account', id, 'transactions', q], () => api.accounts.transactions(id!, q), { enabled: !!id })
export const usePositionEvents = (id: string | undefined, q: PageQuery = {}) => useUserQuery(['account', id, 'position-events', q], () => api.accounts.positionEvents(id!, q), { enabled: !!id })
export const useActivity = (q: ActivityQuery) => useUserQuery(['activity', q], () => api.activity.list(q), { placeholderData: (prev) => prev })
export const useInstruments = () => useUserQuery(['instruments'], () => api.instruments.list())
export const useInstrument = (id: string | undefined) => useUserQuery(['instrument', id], () => api.instruments.get(id!), { enabled: !!id })
export const useInstrumentHoldings = (id: string | undefined) => useUserQuery(['instrument', id, 'holdings'], () => api.instruments.holdings(id!), { enabled: !!id })
export const useGoals = () => useUserQuery(['goals'], () => api.goals.list())
export const useGoal = (id: string | undefined) => useUserQuery(['goal', id], () => api.goals.get(id!), { enabled: !!id })
export const useGoalMilestones = (id: string | undefined) => useUserQuery(['goal', id, 'milestones'], () => api.goals.milestones(id!), { enabled: !!id })
export const useGoalAlerts = () => useUserQuery(['goals', 'alerts'], () => api.goals.alerts())
/** What-if scenarios: fetched through the data layer, never saved to the goal. */
export const useGoalScenarios = (id: string | undefined, params: { monthlyContributionMinor: string; annualReturnBps: number } | null) =>
  useUserQuery(['goal', id, 'scenarios', params], () => api.goals.scenarios(id!, params!), { enabled: !!id && !!params, placeholderData: (prev) => prev })
export const useReportSummary = () => useUserQuery(['reports', 'summary'], () => api.reports.summary())
export const useReportAllocation = () => useUserQuery(['reports', 'allocation'], () => api.reports.allocation())
export const useFlows = (range: DashboardRange) => useUserQuery(['reports', 'flows', range], () => api.reports.flows(range), { placeholderData: (prev) => prev })
export const useIncome = (range: DashboardRange) => useUserQuery(['reports', 'income', range], () => api.reports.income(range), { placeholderData: (prev) => prev })
export const useNetWorthStats = () => useUserQuery(['reports', 'net-worth-stats'], () => api.reports.netWorthStats())
export const useAccountComparison = (range: DashboardRange) =>
  useUserQuery(['reports', 'comparison', range], () => api.reports.accountComparison(range), { placeholderData: (prev) => prev })
export const useAttention = () => useUserQuery(['attention'], () => api.reports.attention())
export const useSettings = () => useUserQuery(['settings'], () => api.settings.get(), { staleTime: 60_000 })
export const useCategories = () => useUserQuery(['categories'], () => api.categories.list())
export const useInstitutions = () => useUserQuery(['institutions'], () => api.institutions.list())

// ---- mutations ----------------------------------------------------------------

export interface ApiMutationOptions<TVars, TResult> {
  mutationFn: (vars: TVars) => Promise<TResult>
  /** Toast shown on success. A function receives the result and variables. */
  success?: string | ((result: TResult, vars: TVars) => string)
  /** Set false when the caller renders the error itself (for example, form field errors). */
  toastError?: boolean
  onSuccess?: (result: TResult, vars: TVars) => void
}

/** Mutation that is blocked offline, invalidates the user's cache, and confirms with a toast. */
export function useApiMutation<TVars, TResult>({ mutationFn, success, toastError = true, onSuccess }: ApiMutationOptions<TVars, TResult>) {
  const qc = useQueryClient()
  const userKey = useUserKey()
  return useMutation<TResult, Error, TVars>({
    mutationFn: async (vars) => {
      if (!isOnline()) {
        throw new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: "You're offline. Changes need a connection to the server." })
      }
      return mutationFn(vars)
    },
    onSuccess: async (result, vars) => {
      await qc.invalidateQueries({ queryKey: ['u', userKey] })
      if (success) toast.success(typeof success === 'function' ? success(result, vars) : success)
      onSuccess?.(result, vars)
    },
    onError: (error) => {
      if (toastError) toast.error(ApiProblem.is(error) ? error.title : 'Something went wrong', { description: problemMessage(error) })
    },
  })
}

/** A fresh idempotency key for one submission attempt. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

// ---- advanced workflows, estate, AI, API keys --------------------------------

export const usePositionEvent = (accountId: string | undefined, id: string | undefined) =>
  useUserQuery(['account', accountId, 'position-event', id], () => api.positionEvents.get(accountId!, id!), { enabled: !!accountId && !!id })
export const useReconciliations = (accountId: string | undefined) => useUserQuery(['account', accountId, 'reconciliations'], () => api.reconciliations.list(accountId!, { limit: 100 }), { enabled: !!accountId })
export const useEstate = () => useUserQuery(['estate'], () => api.estate.get())
export const useEstateSnapshot = (id: string | undefined) => useUserQuery(['estate', 'snapshot', id], () => api.estate.getSnapshot(id!), { enabled: !!id })
export const useAI = () => useUserQuery(['ai'], () => api.ai.get())
export const useApiKeys = () => useUserQuery(['api-keys'], () => api.apiKeys.list())
export const useConnectedApps = () => useUserQuery(['connected-apps'], () => api.connectedApps.list())
export const useOAuthRequest = (id: string | null) => useUserQuery(['oauth-request', id], () => api.oauth.request(id!), { enabled: !!id, retry: false })
export const useAuthConfig = () => useQuery({ queryKey: ['auth-config'], queryFn: () => api.auth.config(), staleTime: 5 * 60_000 })
