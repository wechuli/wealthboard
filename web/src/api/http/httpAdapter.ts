/**
 * HTTP adapter targeting the real Wealthboard API at /api/v1.
 * Implemented but unused until VITE_DATA_SOURCE=http.
 *
 * - Sends cookies (credentials: 'include').
 * - Bootstraps GET /session for { user, csrfToken } and adds X-CSRF-Token to every mutation.
 * - Adds a per-submission Idempotency-Key header to financial mutations.
 * - Sends the preview's SHA-256 hash (X-Preview-Hash) with import commits.
 * - Parses application/problem+json errors into ApiProblem.
 */
import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from '../schema'
import type { DataSource, ImportFile, PageQuery } from '../datasource'
import { ApiProblem, isProblemShape } from '../problem'
import type { ActivityQuery } from '../extensions'
import type { APIKeyMetadata, SessionResponse } from '../types'

export const API_BASE = '/api/v1'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

let csrfToken: string | null = null

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (MUTATING.has(request.method) && csrfToken) request.headers.set('X-CSRF-Token', csrfToken)
    return request
  },
}

async function toProblem(response: Response, body: unknown): Promise<ApiProblem> {
  if (isProblemShape(body)) {
    return new ApiProblem({ type: body.type ?? 'about:blank', title: body.title, status: body.status, detail: body.detail ?? '' })
  }
  return new ApiProblem({
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
    detail: response.status === 0 ? 'The server could not be reached.' : `The server responded with ${response.status}.`,
  })
}

function networkProblem(): ApiProblem {
  return new ApiProblem({ type: 'about:blank', title: 'Offline', status: 0, detail: 'The server could not be reached. Check your connection.' })
}

/** Unwraps an openapi-fetch result, throwing ApiProblem for error responses. */
async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response }
  try {
    result = await promise
  } catch {
    throw networkProblem()
  }
  if (!result.response.ok) throw await toProblem(result.response, result.error)
  return result.data as T
}

async function rawFetch(path: string, init: RequestInit & { idempotencyKey?: string; previewHash?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (MUTATING.has(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken)
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey)
  if (init.previewHash) headers.set('X-Preview-Hash', init.previewHash)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw networkProblem()
  }
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => null)
    throw await toProblem(response, body)
  }
  return response
}

async function getJson<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') params.set(k, String(v))
  const qs = params.toString()
  const response = await rawFetch(`${path}${qs ? `?${qs}` : ''}`)
  return (await response.json()) as T
}

async function sendJson<T>(path: string, method: string, body?: unknown, extra: { idempotencyKey?: string } = {}): Promise<T> {
  const response = await rawFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    idempotencyKey: extra.idempotencyKey,
  })
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** OIDC link/re-auth answer with a 303 to the provider: follow it, then hand the browser over. */
async function redirectingPost(path: string, body?: unknown): Promise<void> {
  const headers = new Headers({ Accept: 'application/json' })
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', redirect: 'follow', headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw networkProblem()
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => null)
    throw await toProblem(response, problem)
  }
  // The server answers JSON clients with the provider URL instead of a cross-site 303 that fetch cannot follow.
  const payload: unknown = await response.json().catch(() => null)
  if (payload && typeof payload === 'object' && 'redirectUrl' in payload && typeof payload.redirectUrl === 'string') {
    window.location.assign(payload.redirectUrl)
    return
  }
  if (response.redirected) {
    window.location.assign(response.url)
    return
  }
  throw new ApiProblem({ type: 'about:blank', title: 'Sign-in provider unavailable', status: response.status, detail: 'The sign-in provider could not be reached. Try again in a moment.' })
}

function importBody(file: ImportFile): { body: string; contentType: string } {
  return { body: file.content, contentType: file.format === 'csv' ? 'text/csv' : 'application/json' }
}

export function createHttpDataSource(baseUrl = API_BASE): DataSource {
  const client = createClient<paths>({ baseUrl, credentials: 'include' })
  client.use(csrfMiddleware)
  const page = (q?: PageQuery) => ({ limit: q?.limit, offset: q?.offset, from: q?.from, to: q?.to })

  return {
    kind: 'http',

    auth: {
      config: () => unwrap(client.GET('/auth/config')),
      async session() {
        try {
          const session = await unwrap(client.GET('/session'))
          setCsrfToken(session.csrfToken)
          return session
        } catch (error) {
          if (ApiProblem.is(error) && error.status === 401) {
            setCsrfToken(null)
            return null
          }
          throw error
        }
      },
      async login(body) {
        const session = await unwrap(client.POST('/auth/login', { body }))
        setCsrfToken(session.csrfToken)
        return session
      },
      async signup(body) {
        const session = await unwrap(client.POST('/auth/signup', { body }))
        setCsrfToken(session.csrfToken)
        return session
      },
      async logout() {
        await unwrap(client.POST('/auth/logout', { params: { header: { 'X-CSRF-Token': csrfToken ?? '' } } }))
        setCsrfToken(null)
      },
      async changePassword(body) {
        const session = await unwrap(client.POST('/auth/change-password', { body, params: { header: { 'X-CSRF-Token': csrfToken ?? '' } } }))
        setCsrfToken(session.csrfToken)
      },
      oidcStartUrl: (next) => `${baseUrl}/auth/oidc/start${next ? `?next=${encodeURIComponent(next)}` : ''}`,
      linkOidc: (currentPassword) => redirectingPost('/auth/oidc/link', { currentPassword, next: '/settings/security' }),
      async unlinkOidc(currentPassword) {
        const session = await sendJson<SessionResponse>('/auth/oidc/link', 'DELETE', { currentPassword })
        setCsrfToken(session.csrfToken)
        return session
      },
      reauthenticateOidc: (next = '/settings/security') => redirectingPost(`/auth/oidc/reauth?next=${encodeURIComponent(next)}`),
      async enableLocalCredential(body) {
        const session = await sendJson<SessionResponse>('/auth/local-credential', 'POST', body)
        setCsrfToken(session.csrfToken)
        return session
      },
      async removeLocalCredential() {
        const session = await sendJson<SessionResponse>('/auth/local-credential', 'DELETE')
        setCsrfToken(session.csrfToken)
        return session
      },
    },

    dashboard: {
      get: (range) => unwrap(client.GET('/dashboard', { params: { query: { range } } })),
    },

    accounts: {
      list: async (archived = 'active') => (await unwrap(client.GET('/accounts', { params: { query: { archived } } }))).items,
      summaries: () => getJson('/accounts/summaries'),
      get: (id) => unwrap(client.GET('/accounts/{accountID}', { params: { path: { accountID: id } } })),
      create: (body) => unwrap(client.POST('/accounts', { body, headers: { 'Idempotency-Key': body.idempotencyKey } } as never)),
      update: async (id, body) => {
        await unwrap(client.PATCH('/accounts/{accountID}', { params: { path: { accountID: id } }, body } as never))
      },
      setArchived: async (id, archived) => {
        await unwrap(client.POST('/accounts/{accountID}/archive', { params: { path: { accountID: id } }, body: { archived } } as never))
      },
      remove: async (id, confirmationName) => {
        await unwrap(client.DELETE('/accounts/{accountID}', { params: { path: { accountID: id } }, body: { confirmationName } } as never))
      },
      analytics: (id) => unwrap(client.GET('/accounts/{accountID}/analytics', { params: { path: { accountID: id } } })),
      extras: (id) => getJson(`/accounts/${id}/extras`),
      activity: (id, q) => unwrap(client.GET('/accounts/{accountID}/activity', { params: { path: { accountID: id }, query: page(q) } })),
      transactions: (id, q) => unwrap(client.GET('/accounts/{accountID}/transactions', { params: { path: { accountID: id }, query: page(q) } })),
      valuations: (id, q) => unwrap(client.GET('/accounts/{accountID}/valuations', { params: { path: { accountID: id }, query: page(q) } })),
      positionEvents: (id, q) =>
        unwrap(client.GET('/accounts/{accountID}/position-events', { params: { path: { accountID: id }, query: { limit: q?.limit, offset: q?.offset } } } as never)),
    },

    activity: {
      list: (q: ActivityQuery) => getJson('/activity', { ...q }),
    },

    transactions: {
      create: (body) => unwrap(client.POST('/transactions', { body, headers: { 'Idempotency-Key': body.idempotencyKey } } as never)),
      update: async (id, body) => {
        await unwrap(client.PATCH('/transactions/{id}', { params: { path: { id } }, body } as never))
      },
      remove: async (id) => {
        await unwrap(client.DELETE('/transactions/{id}', { params: { path: { id } } } as never))
      },
    },

    valuations: {
      create: (body) => unwrap(client.POST('/valuations', { body, headers: { 'Idempotency-Key': body.idempotencyKey } } as never)),
      remove: async (id) => {
        await unwrap(client.DELETE('/valuations/{id}', { params: { path: { id } } } as never))
      },
    },

    transfers: {
      create: (body) => unwrap(client.POST('/transfers', { body, headers: { 'Idempotency-Key': body.idempotencyKey } } as never)),
    },

    instruments: {
      list: async () => (await unwrap(client.GET('/instruments'))).instruments,
      get: (id) => unwrap(client.GET('/instruments/{id}', { params: { path: { id } } })),
      holdings: (id) => getJson(`/instruments/${id}/holdings`),
      create: (body) => unwrap(client.POST('/instruments', { body } as never)),
      update: async (id, body) => {
        await unwrap(client.PUT('/instruments/{id}', { params: { path: { id } }, body } as never))
      },
      setArchived: async (id, archived) => {
        await unwrap(client.PATCH('/instruments/{id}/archive', { params: { path: { id } }, body: { archived } } as never))
      },
      remove: (id) => sendJson(`/instruments/${id}`, 'DELETE'),
    },

    prices: {
      upsert: (body, { idempotencyKey }) => unwrap(client.PUT('/security-prices', { body, headers: { 'Idempotency-Key': idempotencyKey } } as never)),
      remove: async (id) => {
        await unwrap(client.DELETE('/security-prices/{id}', { params: { path: { id } } } as never))
      },
    },

    positionEvents: {
      get: (accountId, id) => getJson(`/accounts/${accountId}/position-events/${id}`),
      update: (id, body) => sendJson(`/position-events/${id}`, 'PUT', body),
      create: (body) => unwrap(client.POST('/position-events', { body, headers: { 'Idempotency-Key': body.idempotencyKey } } as never)),
      remove: async (id) => {
        await unwrap(client.DELETE('/position-events/{id}', { params: { path: { id } } } as never))
      },
    },

    reconciliations: {
      list: (accountId, q) => getJson(`/accounts/${accountId}/position-reconciliations`, { limit: q?.limit, offset: q?.offset }),
      create: (body) => sendJson('/position-reconciliations', 'POST', body),
      remove: (id) => sendJson(`/position-reconciliations/${id}`, 'DELETE'),
    },

    conversions: {
      preview: (body, { idempotencyKey }) => sendJson('/account-conversions/preview', 'POST', { ...body, idempotencyKey }, { idempotencyKey }),
      execute: (body, { idempotencyKey }) => sendJson('/account-conversions', 'POST', { ...body, idempotencyKey }, { idempotencyKey }),
    },

    corporateActions: {
      create: (kind, body, { idempotencyKey }) => sendJson(`/corporate-actions/${kind}`, 'POST', { ...body, idempotencyKey }, { idempotencyKey }),
      remove: (id) => sendJson(`/corporate-actions/${id}`, 'DELETE'),
    },

    estate: {
      get: () => getJson('/estate'),
      updatePlan: (body) => sendJson('/estate/plan', 'PUT', body),
      createBeneficiary: (body) => sendJson('/estate/beneficiaries', 'POST', body),
      updateBeneficiary: (id, body) => sendJson(`/estate/beneficiaries/${id}`, 'PUT', body),
      setBeneficiaryArchived: (id, archived) => sendJson(`/estate/beneficiaries/${id}/archive`, 'PATCH', { archived }),
      upsertDirective: (accountId, body) => sendJson(`/estate/directives/${accountId}`, 'PUT', body),
      upsertAllocation: (directiveId, body) => sendJson(`/estate/allocations/${directiveId}`, 'PUT', body),
      removeAllocation: (id) => sendJson(`/estate/allocations/${id}`, 'DELETE'),
      upsertResiduary: (body) => sendJson('/estate/residuary', 'PUT', body),
      removeResiduary: (id) => sendJson(`/estate/residuary/${id}`, 'DELETE'),
      createSnapshot: () => sendJson('/estate/snapshots', 'POST'),
      getSnapshot: (id) => getJson(`/estate/snapshots/${id}`),
      removeSnapshot: (id) => sendJson(`/estate/snapshots/${id}`, 'DELETE'),
    },

    ai: {
      get: () => getJson('/ai'),
      saveSettings: (body) => sendJson('/ai/settings', 'PUT', body),
      disconnect: () => sendJson('/ai/settings', 'DELETE'),
      saveCredential: (apiKey) => sendJson('/ai/credential', 'POST', { apiKey }),
      removeCredential: () => sendJson('/ai/credential', 'DELETE'),
      clearUsage: () => sendJson('/ai/usage/clear', 'POST'),
      review: (body) => sendJson('/ai/review', 'POST', body),
      convertImport: (body) => sendJson('/ai/import/convert', 'POST', body),
    },

    apiKeys: {
      list: async () => (await getJson<{ keys: APIKeyMetadata[] }>('/api-keys')).keys,
      create: (body) => sendJson('/api-keys', 'POST', body),
      revoke: (id) => sendJson(`/api-keys/${id}`, 'DELETE'),
      revokeAll: () => sendJson('/api-keys/revoke-all', 'POST'),
    },

    goals: {
      list: () => unwrap(client.GET('/goals')),
      get: (id) => unwrap(client.GET('/goals/{id}', { params: { path: { id } } })),
      create: (body, { idempotencyKey }) =>
        unwrap(client.POST('/goals', { body: { ...body, idempotencyKey }, params: { header: { 'Idempotency-Key': idempotencyKey } } } as never)),
      update: async (id, body) => {
        await unwrap(client.PUT('/goals/{id}', { params: { path: { id } }, body } as never))
      },
      remove: async (id) => {
        await unwrap(client.DELETE('/goals/{id}', { params: { path: { id } } } as never))
      },
      setStatus: async (id, status) => {
        await unwrap(client.PATCH('/goals/{id}/status', { params: { path: { id } }, body: { status } } as never))
      },
      scenarios: (id, query) => unwrap(client.GET('/goals/{id}/scenarios', { params: { path: { id }, query } })),
      milestones: (id) => unwrap(client.GET('/goals/{id}/milestones', { params: { path: { id } } })),
      createMilestone: (id, body) => unwrap(client.POST('/goals/{id}/milestones', { params: { path: { id } }, body } as never)),
      removeMilestone: async (id, milestoneId) => {
        await unwrap(client.DELETE('/goals/{id}/milestones/{milestoneId}', { params: { path: { id, milestoneId } } } as never))
      },
      alerts: () => unwrap(client.GET('/goals/alerts')),
      dismissAlert: async (id) => {
        await unwrap(client.POST('/goals/{id}/alerts/dismiss', { params: { path: { id } } } as never))
      },
    },

    reports: {
      summary: () => unwrap(client.GET('/reports/summary')),
      allocation: () => unwrap(client.GET('/reports/allocation')),
      flows: (range) => getJson('/reports/flows', { range }),
      income: (range) => getJson('/reports/income', { range }),
      netWorthStats: () => getJson('/reports/net-worth-stats'),
      accountComparison: (range) => getJson('/reports/account-comparison', { range }),
      attention: () => getJson('/attention'),
    },

    settings: {
      get: () => unwrap(client.GET('/settings')),
      update: async (body) => {
        await unwrap(client.PUT('/settings', { body } as never))
      },
    },

    categories: {
      list: async () => (await unwrap(client.GET('/categories'))).items,
      create: (body) => unwrap(client.POST('/categories', { body } as never)),
      update: async (id, body) => {
        await unwrap(client.PUT('/categories/{id}', { params: { path: { id } }, body } as never))
      },
      setArchived: async (id, archived) => {
        await unwrap(client.PATCH('/categories/{id}/archive', { params: { path: { id } }, body: { archived } } as never))
      },
      reorder: async (id, direction) => {
        await unwrap(client.POST('/categories/{id}/reorder', { params: { path: { id } }, body: { direction } } as never))
      },
    },

    institutions: {
      list: async () => (await unwrap(client.GET('/institutions'))).items,
      create: (body) => unwrap(client.POST('/institutions', { body } as never)),
      update: async (id, body) => {
        await unwrap(client.PUT('/institutions/{id}', { params: { path: { id } }, body } as never))
      },
      setArchived: async (id, archived) => {
        await unwrap(client.PATCH('/institutions/{id}/archive', { params: { path: { id } }, body: { archived } } as never))
      },
    },

    exchangeRates: {
      create: (body, { idempotencyKey }) => unwrap(client.POST('/exchange-rates', { body, headers: { 'Idempotency-Key': idempotencyKey } } as never)),
      remove: async (id) => {
        await unwrap(client.DELETE('/exchange-rates/{id}', { params: { path: { id } } } as never))
      },
    },

    imports: {
      async previewAccountHistory(accountId, file) {
        const { body, contentType } = importBody(file)
        const response = await rawFetch(`/accounts/${accountId}/history-import/preview`, { method: 'POST', body, headers: { 'Content-Type': contentType } })
        return response.json()
      },
      async commitAccountHistory(accountId, file, hash) {
        const { body, contentType } = importBody(file)
        const response = await rawFetch(`/accounts/${accountId}/history-import/commit`, {
          method: 'POST',
          body,
          headers: { 'Content-Type': contentType },
          previewHash: hash,
        })
        return response.json()
      },
      async previewInvestmentHistory(accountId, file) {
        const { body, contentType } = importBody(file)
        const response = await rawFetch(`/accounts/${accountId}/investment-import/preview`, { method: 'POST', body, headers: { 'Content-Type': contentType } })
        return response.json()
      },
      async commitInvestmentHistory(accountId, file, hash) {
        const { body, contentType } = importBody(file)
        const response = await rawFetch(`/accounts/${accountId}/investment-import/commit`, { method: 'POST', body, headers: { 'Content-Type': contentType }, previewHash: hash })
        return response.json()
      },
    },

    exports: {
      userArchive: () => unwrap(client.GET('/exports/user')),
      transactionsCsv: async () => (await rawFetch('/exports/transactions.csv')).text(),
      accountsCsv: async () => (await rawFetch('/exports/accounts.csv')).text(),
      restore: (archive) => unwrap(client.POST('/restore/user', { body: archive } as never)),
      async restoreFile(file) {
        const form = new FormData()
        form.append('file', file)
        const response = await rawFetch('/restore/user', { method: 'POST', body: form })
        return response.json()
      },
    },
  }
}
