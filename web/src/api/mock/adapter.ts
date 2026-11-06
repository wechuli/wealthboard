/**
 * Mock adapter: the default data source. Simulates latency, scenarios (full, empty, incomplete,
 * slow, errors), auth modes, and realistic problem+json failures. Each user has a private world;
 * signing out or switching users never leaks another user's data.
 */
import { todayISO } from '@/lib/dates'
import { percentToBps } from '@/lib/money'
import type { DataSource } from '../datasource'
import { ApiProblem } from '../problem'
import type { AccountHistoryImportResult, Category, EstateSnapshot, SessionResponse, UserArchive } from '../types'
import { convertMinor, fromScaled, majorToMinor, mulToMinor, toScaled } from './decimal'
import { Engine } from './engine'
import { DEMO_USER, emptyWorld, fullWorld } from './fixtures'
import { evaluateImport, parseImport, sha256 } from './importer'
import { randomId, stableId } from './rng'
import { getScenario, onScenarioChange } from './scenario'
import { buildWorkspace, demoSideState, emptySideState, newApiKey, type SideState } from './side'
import { IDS } from './fixtures'
import type { AccountRecord, MockUser, World } from './world'

export const DEMO_PASSWORD = 'wealthboard-demo'
const SESSION_KEY = 'wealthboard-mock-session'
const USERS_KEY = 'wealthboard-mock-users'

let latencyOverride: number | null = null
/** Tests can disable latency. */
export function setMockLatency(ms: number | null): void {
  latencyOverride = ms
}

function delay(): Promise<void> {
  const scenario = getScenario()
  const ms = latencyOverride ?? (scenario.data === 'slow' ? 2500 + Math.random() * 1500 : 180 + Math.random() * 380)
  return new Promise((r) => setTimeout(r, ms))
}

function problem(status: number, title: string, detail: string, type = 'about:blank', fieldErrors?: Record<string, string>): ApiProblem {
  return new ApiProblem({ type, title, status, detail, fieldErrors })
}

const notFound = (what: string) => problem(404, 'Not found', `That ${what} doesn't exist or was deleted.`, 'https://wealthboard.dev/problems/not-found')
const invalid = (detail: string, fieldErrors?: Record<string, string>) => problem(422, 'Check the highlighted fields', detail, 'https://wealthboard.dev/problems/validation', fieldErrors)

// ---- session & users ------------------------------------------------------------

interface StoredUser extends MockUser {
  displayName: string
  baseCurrency: string
}

function readUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as StoredUser[]
  } catch {
    return []
  }
}

function writeUsers(users: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function readSessionUser(): MockUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw === null) return DEMO_USER
    if (raw === 'signed-out') return null
    return JSON.parse(raw) as MockUser
  } catch {
    return DEMO_USER
  }
}

function writeSessionUser(user: MockUser | null): void {
  localStorage.setItem(SESSION_KEY, user ? JSON.stringify(user) : 'signed-out')
}

function sessionFor(user: MockUser): SessionResponse {
  return { user: { id: user.id, username: user.username }, csrfToken: `mock-${user.id.slice(0, 8)}` }
}

// ---- worlds ---------------------------------------------------------------------

const worlds = new Map<string, World>()
const engines = new Map<string, { version: number; engine: Engine }>()
const idempotency = new Map<string, unknown>()
const sides = new Map<string, SideState>()

let scenarioListener = false
function listenForScenarioChanges(): void {
  if (scenarioListener) return
  scenarioListener = true
  onScenarioChange(() => {
    worlds.clear()
    engines.clear()
    sides.clear()
  })
}

function worldFor(user: MockUser): World {
  let w = worlds.get(user.id)
  if (!w) {
    const scenario = getScenario().data
    if (user.id === DEMO_USER.id) {
      w = scenario === 'empty' ? emptyWorld(DEMO_USER, { displayName: 'Amani Wanjiru' }) : fullWorld(scenario)
    } else {
      const stored = readUsers().find((u) => u.id === user.id)
      w = emptyWorld(user, { displayName: stored?.displayName ?? user.username, baseCurrency: stored?.baseCurrency ?? 'KES' })
    }
    worlds.set(user.id, w)
  }
  return w
}

function requireUser(): MockUser {
  const user = readSessionUser()
  if (!user) throw problem(401, 'Signed out', 'Your session has ended. Sign in again.')
  return user
}

function engineFor(world: World): Engine {
  const cached = engines.get(world.user.id)
  if (cached && cached.version === world.version) return cached.engine
  const engine = new Engine(world)
  engines.set(world.user.id, { version: world.version, engine })
  return engine
}

/** Runs a read against the signed-in user's world after simulated latency. */
function checkPage(q?: { limit?: number; offset?: number }): void {
  if (q?.limit !== undefined && (q.limit < 1 || q.limit > 100)) throw problem(400, 'Invalid request', 'limit must be between 1 and 100.')
  if (q?.offset !== undefined && (q.offset < 0 || q.offset > 10000)) throw problem(400, 'Invalid request', 'offset must be between 0 and 10000.')
}

async function read<T>(fn: (e: Engine, w: World) => T, opts: { allowInErrorScenario?: boolean } = {}): Promise<T> {
  await delay()
  const user = requireUser()
  if (getScenario().data === 'errors' && !opts.allowInErrorScenario) {
    throw problem(503, 'Service unavailable', "Wealthboard couldn't load this data. The server reported an internal error (mock scenario).", 'https://wealthboard.dev/problems/unavailable')
  }
  const w = worldFor(user)
  return structuredClone(fn(engineFor(w), w))
}

async function write<T>(fn: (w: World, e: Engine) => T, idempotencyKey?: string): Promise<T> {
  await delay()
  const user = requireUser()
  if (getScenario().data === 'errors') {
    throw problem(503, 'Service unavailable', 'Your change was not saved. The server reported an internal error (mock scenario).')
  }
  if (idempotencyKey && idempotency.has(idempotencyKey)) return idempotency.get(idempotencyKey) as T
  const w = worldFor(user)
  const result = fn(w, engineFor(w))
  w.version++
  if (idempotencyKey) idempotency.set(idempotencyKey, result)
  return result
}

const nowStamp = () => new Date().toISOString()

function sideFor(w: World): SideState {
  let side = sides.get(w.user.id)
  if (!side) {
    side = w.user.id === DEMO_USER.id && w.accounts.length > 0 ? demoSideState({ land: IDS.land, zimele: IDS.zimele, madison: IDS.madison, loan: IDS.loan }) : emptySideState()
    sides.set(w.user.id, side)
  }
  return side
}

const unsupported = (what: string) => problem(501, 'Not available in the mock', `${what} needs the real server. Run the client against the Go API to try it.`)

function findAccount(w: World, id: string): AccountRecord {
  const a = w.accounts.find((x) => x.id === id)
  if (!a) throw notFound('account')
  return a
}

function positiveMinor(value: string, field: string): bigint {
  if (!/^-?\d+$/.test(value)) throw invalid('Amounts must be whole minor units.', { [field]: 'Enter a valid amount' })
  const v = BigInt(value)
  if (v <= 0n) throw invalid('Enter an amount greater than zero.', { [field]: 'Must be greater than zero' })
  return v
}

// ---- adapter --------------------------------------------------------------------

export function createMockDataSource(): DataSource {
  listenForScenarioChanges()
  return {
    kind: 'mock',

    auth: {
      async config() {
        await delay()
        const auth = getScenario().auth
        return { localEnabled: auth !== 'oidc', oidcEnabled: auth !== 'local', providerName: 'Home SSO' }
      },
      async session() {
        await delay()
        const user = readSessionUser()
        if (user && getScenario().auth === 'oidc' && user.id !== DEMO_USER.id && !readUsers().some((u) => u.id === user.id)) return null
        return user ? sessionFor(user) : null
      },
      async login({ username, password }) {
        await delay()
        if (getScenario().auth === 'oidc') throw problem(403, 'Password sign-in is off', 'This server only allows single sign-on.')
        const name = username.trim().toLowerCase()
        const registered = readUsers().find((u) => u.username === name)
        const ok = (name === DEMO_USER.username && password === DEMO_PASSWORD) || (!!registered && password.length >= 12)
        if (!ok) throw problem(401, 'Sign-in failed', 'That username and password combination is not recognised.', 'https://wealthboard.dev/problems/invalid-credentials')
        const user = registered ? { id: registered.id, username: registered.username } : DEMO_USER
        writeSessionUser(user)
        return sessionFor(user)
      },
      async signup(body) {
        await delay()
        if (getScenario().auth === 'oidc') throw problem(403, 'Sign-up is off', 'New profiles are created through single sign-on.')
        const username = body.username.trim().toLowerCase()
        if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw invalid('Usernames are 3–32 characters: letters, numbers, dots, underscores, or hyphens.', { username: 'Use 3–32 letters, numbers, . _ or -' })
        if (body.password.length < 12) throw invalid('Passwords need at least 12 characters.', { password: 'At least 12 characters' })
        if (body.password !== body.confirmPassword) throw invalid('The passwords do not match.', { confirmPassword: 'Passwords do not match' })
        if (username === DEMO_USER.username || readUsers().some((u) => u.username === username)) {
          throw problem(409, 'Username taken', 'Choose a different username.', 'https://wealthboard.dev/problems/conflict', { username: 'This username is taken' })
        }
        const user: StoredUser = { id: randomId(), username, displayName: body.displayName.trim() || username, baseCurrency: body.baseCurrency ?? 'KES' }
        writeUsers([...readUsers(), user])
        writeSessionUser(user)
        return sessionFor(user)
      },
      async logout() {
        await delay()
        writeSessionUser(null)
      },
      async changePassword(body) {
        await delay()
        const user = requireUser()
        if (user.id === DEMO_USER.id && body.currentPassword !== DEMO_PASSWORD) {
          throw problem(400, 'Password not changed', 'Your current password is incorrect.', 'about:blank', { currentPassword: 'Incorrect password' })
        }
        if (body.newPassword.length < 12) throw invalid('Passwords need at least 12 characters.', { newPassword: 'At least 12 characters' })
        if (body.newPassword !== body.confirmPassword) throw invalid('The passwords do not match.', { confirmPassword: 'Passwords do not match' })
      },
      oidcStartUrl: (next) => `/sign-in?mock-oidc=1${next ? `&next=${encodeURIComponent(next)}` : ''}`,
      async linkOidc() {
        await delay()
        throw unsupported('Linking single sign-on')
      },
      async unlinkOidc() {
        await delay()
        throw unsupported('Unlinking single sign-on')
      },
      async reauthenticateOidc() {
        await delay()
        throw unsupported('Re-authenticating with single sign-on')
      },
      async enableLocalCredential() {
        await delay()
        throw unsupported('Adding a password')
      },
      async removeLocalCredential() {
        await delay()
        throw unsupported('Removing the password')
      },
      async completeMockOidc() {
        await delay()
        writeSessionUser(DEMO_USER)
        return sessionFor(DEMO_USER)
      },
    },

    dashboard: {
      get: (range) => read((e) => e.dashboard(range)),
    },

    accounts: {
      list: (archived = 'active') => read((e) => e.accounts(archived)),
      summaries: () => read((e) => e.summaries()),
      get: (id) =>
        read((e) => {
          const a = e.account(id)
          if (!a) throw notFound('account')
          return e.toAccount(a)
        }),
      create: (body) =>
        write((w, e) => {
          const name = body.name.trim()
          if (!name) throw invalid('Give the account a name.', { name: 'Required' })
          if (w.accounts.some((a) => !a.archivedAt && a.name.toLowerCase() === name.toLowerCase())) {
            throw problem(409, 'Name already used', `You already have an account called “${name}”.`, 'https://wealthboard.dev/problems/conflict', { name: 'Already used' })
          }
          if (!w.categories.some((c) => c.id === body.categoryId)) throw invalid('Choose a category.', { categoryId: 'Required' })
          const id = randomId()
          const openedAt = body.openedAt ?? e.today
          w.accounts.push({
            id,
            name,
            description: body.description,
            categoryId: body.categoryId,
            institutionId: body.institutionId ?? undefined,
            currency: body.currency,
            trackingMode: body.trackingMode ?? 'balance',
            isIncludedInNetWorth: body.isIncludedInNetWorth ?? true,
            costBasisMinor: body.costBasisMinor ? BigInt(body.costBasisMinor) : undefined,
            accountReference: body.accountReference,
            notes: body.notes,
            openedAt,
          })
          const opening = BigInt(body.openingValueMinor)
          if (opening > 0n) {
            w.transactions.push({ id: randomId(), accountId: id, type: 'opening_balance', amountMinor: opening, date: openedAt, seq: w.seq++, description: 'Opening balance', createdAt: nowStamp() })
          }
          return { id }
        }, body.idempotencyKey),
      update: (id, body) =>
        write((w) => {
          const a = findAccount(w, id)
          Object.assign(a, {
            name: body.name.trim(),
            description: body.description,
            categoryId: body.categoryId,
            institutionId: body.institutionId ?? undefined,
            accountReference: body.accountReference,
            notes: body.notes,
            isIncludedInNetWorth: body.isIncludedInNetWorth ?? a.isIncludedInNetWorth,
          })
        }, body.idempotencyKey),
      setArchived: (id, archived) =>
        write((w) => {
          const a = findAccount(w, id)
          a.archivedAt = archived ? nowStamp() : undefined
        }),
      remove: (id, confirmationName) =>
        write((w) => {
          const a = findAccount(w, id)
          if (confirmationName !== a.name) throw invalid('Type the account name exactly to confirm.', { confirmationName: 'Does not match' })
          w.accounts = w.accounts.filter((x) => x.id !== id)
          w.transactions = w.transactions.filter((t) => t.accountId !== id)
          w.valuations = w.valuations.filter((v) => v.accountId !== id)
          w.positionEvents = w.positionEvents.filter((p) => p.accountId !== id)
        }),
      analytics: (id) =>
        read((e) => {
          if (!e.account(id)) throw notFound('account')
          return e.analytics(id)
        }),
      extras: (id) =>
        read((e) => {
          if (!e.account(id)) throw notFound('account')
          return e.extras(id)
        }),
      activity: (id, q) => read((e) => (checkPage(q), e.activity({ accountId: id, from: q?.from, to: q?.to, limit: q?.limit, offset: q?.offset }))),
      transactions: (id, q) =>
        read((e) => {
          checkPage(q)
          const all = e
            .txns(id)
            .filter((t) => (!q?.from || t.date >= q.from) && (!q?.to || t.date <= q.to))
            .slice()
            .reverse()
          const limit = q?.limit ?? 50
          const offset = q?.offset ?? 0
          return { items: all.slice(offset, offset + limit).map((t) => e.toTransaction(t)), limit, offset, hasMore: offset + limit < all.length }
        }),
      valuations: (id, q) =>
        read((e) => {
          checkPage(q)
          const all = e.valuations(id).slice().reverse()
          const limit = q?.limit ?? 50
          const offset = q?.offset ?? 0
          return { items: all.slice(offset, offset + limit).map((v) => e.toValuation(v)), limit, offset, hasMore: offset + limit < all.length }
        }),
      positionEvents: (id, q) =>
        read((e) => {
          checkPage(q)
          const all = e.events(id).slice().reverse()
          const limit = q?.limit ?? 50
          const offset = q?.offset ?? 0
          return {
            items: all.slice(offset, offset + limit).map((p) => ({
              id: p.id,
              accountId: p.accountId,
              instrumentId: p.instrumentId,
              type: p.type,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              tradeCurrency: p.tradeCurrency,
              feeAmountMinor: p.feeMinor.toString(),
              feeCurrency: p.tradeCurrency,
              cashEffectMinor: p.cashEffectMinor.toString(),
              tradeDate: p.date,
              eventSequence: p.seq,
              description: p.description,
              notes: p.notes,
              createdAt: p.createdAt,
              updatedAt: p.createdAt,
            })),
            limit,
            offset,
            hasMore: offset + limit < all.length,
          }
        }),
    },

    activity: {
      list: (q) => read((e) => (checkPage(q), e.activity(q))),
    },

    transactions: {
      create: (body) =>
        write((w, e) => {
          const a = findAccount(w, body.accountId)
          if (a.archivedAt) throw invalid('Restore this account before recording activity on it.')
          if (body.transactionDate > e.today) throw invalid('Transactions cannot be in the future.', { transactionDate: 'Choose today or earlier' })
          const amount = body.type === 'manual_adjustment' ? BigInt(body.amountMinor) : positiveMinor(body.amountMinor, 'amountMinor')
          if (a.trackingMode === 'positions' && body.type === 'withdrawal') {
            const cash = e.cashAt(a.id, body.transactionDate)
            if (amount > cash) {
              throw problem(422, 'Not enough cash', `This account holds ${e.minorToMajor(cash, a.currency)} ${a.currency} in cash on that date.`, 'https://wealthboard.dev/problems/insufficient-cash', {
                amountMinor: 'More than the available cash',
              })
            }
          }
          const id = randomId()
          w.transactions.push({ id, accountId: a.id, type: body.type, amountMinor: amount, date: body.transactionDate, seq: w.seq++, description: body.description, notes: body.notes, externalId: body.externalId, createdAt: nowStamp() })
          return { id }
        }, body.idempotencyKey),
      update: (id, body) =>
        write((w) => {
          const t = w.transactions.find((x) => x.id === id)
          if (!t) throw notFound('transaction')
          Object.assign(t, { type: body.type, amountMinor: BigInt(body.amountMinor), date: body.transactionDate, description: body.description, notes: body.notes })
        }, body.idempotencyKey),
      remove: (id) =>
        write((w) => {
          const t = w.transactions.find((x) => x.id === id)
          if (!t) throw notFound('transaction')
          w.transactions = w.transactions.filter((x) => (t.transferGroupId ? x.transferGroupId !== t.transferGroupId : x.id !== id))
        }),
    },

    valuations: {
      create: (body) =>
        write((w, e) => {
          const a = findAccount(w, body.accountId)
          if (a.trackingMode !== 'balance') throw invalid('Position-tracked accounts are valued from prices. Update a price instead.')
          if (body.valuationDate > e.today) throw invalid('Valuations cannot be in the future.', { valuationDate: 'Choose today or earlier' })
          const id = randomId()
          w.valuations.push({ id, accountId: a.id, valueMinor: BigInt(body.valueMinor), date: body.valuationDate, seq: w.seq++, notes: body.notes, createdAt: nowStamp() })
          return { id }
        }, body.idempotencyKey),
      remove: (id) =>
        write((w) => {
          if (!w.valuations.some((v) => v.id === id)) throw notFound('valuation')
          w.valuations = w.valuations.filter((v) => v.id !== id)
        }),
    },

    transfers: {
      create: (body) =>
        write((w, e) => {
          if (body.fromAccountId === body.toAccountId) throw invalid('Choose two different accounts.', { toAccountId: 'Must differ from the source account' })
          const from = findAccount(w, body.fromAccountId)
          const to = findAccount(w, body.toAccountId)
          const source = positiveMinor(body.sourceAmountMinor, 'sourceAmountMinor')
          let dest: bigint
          if (body.destinationAmountMinor) dest = positiveMinor(body.destinationAmountMinor, 'destinationAmountMinor')
          else if (from.currency === to.currency) dest = source
          else throw invalid(`Enter the amount received in ${to.currency}.`, { destinationAmountMinor: 'Required for cross-currency transfers' })
          const group = randomId()
          const date = body.transactionDate
          if (date > e.today) throw invalid('Transfers cannot be in the future.', { transactionDate: 'Choose today or earlier' })
          const id = randomId()
          w.transactions.push({ id, accountId: from.id, type: 'transfer', amountMinor: -source, date, seq: w.seq++, description: body.description ?? `To ${to.name}`, transferGroupId: group, createdAt: nowStamp() })
          w.transactions.push({ id: randomId(), accountId: to.id, type: 'transfer', amountMinor: dest, date, seq: w.seq++, description: body.description ?? `From ${from.name}`, transferGroupId: group, createdAt: nowStamp() })
          return { id }
        }, body.idempotencyKey),
    },

    instruments: {
      list: () => read((e) => e.instrumentsWithLatest()),
      get: (id) =>
        read((e, w) => {
          const inst = e.instrumentsWithLatest().find((i) => i.id === id)
          if (!inst) throw notFound('instrument')
          const prices = w.prices
            .filter((p) => p.instrumentId === id)
            .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))
            .map(({ instrumentId: _i, ...rest }) => rest)
          return { instrument: inst, prices }
        }),
      holdings: (id) =>
        read((e) => {
          if (!e.instrument(id)) throw notFound('instrument')
          return e.instrumentHoldings(id)
        }),
      create: (body) =>
        write((w) => {
          const id = randomId()
          const now = nowStamp()
          w.instruments.push({
            id,
            externalId: body.externalId ?? null,
            name: body.name,
            symbol: body.symbol ?? null,
            identifierType: body.identifierType,
            identifier: body.identifier ?? null,
            exchangeMic: body.exchangeMic ?? null,
            assetType: body.assetType,
            quoteCurrency: body.quoteCurrency,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
            latestPrice: null,
          })
          return { id }
        }),
      update: (id, body) =>
        write((w) => {
          const inst = w.instruments.find((i) => i.id === id)
          if (!inst) throw notFound('instrument')
          Object.assign(inst, { name: body.name, symbol: body.symbol ?? null, identifierType: body.identifierType, identifier: body.identifier ?? null, assetType: body.assetType, updatedAt: nowStamp() })
        }),
      setArchived: (id, archived) =>
        write((w) => {
          const inst = w.instruments.find((i) => i.id === id)
          if (!inst) throw notFound('instrument')
          inst.archivedAt = archived ? nowStamp() : null
        }),
      remove: (id) =>
        write((w) => {
          if (!w.instruments.some((i) => i.id === id)) throw notFound('instrument')
          if (w.positionEvents.some((e) => e.instrumentId === id) || w.prices.some((p) => p.instrumentId === id)) {
            throw problem(409, 'Instrument in use', 'Trades or prices still reference this instrument. Archive it instead, or remove them first.', 'https://wealthboard.dev/problems/conflict')
          }
          w.instruments = w.instruments.filter((i) => i.id !== id)
        }),
    },

    prices: {
      upsert: (body, { idempotencyKey }) =>
        write((w, e) => {
          const inst = w.instruments.find((i) => i.id === body.instrumentId)
          if (!inst) throw notFound('instrument')
          if (body.effectiveDate > e.today) throw invalid('Prices cannot be in the future.', { effectiveDate: 'Choose today or earlier' })
          const effectiveDate = `${body.effectiveDate}T00:00:00Z`
          const existing = w.prices.find((p) => p.instrumentId === inst.id && p.effectiveDate === effectiveDate)
          const now = nowStamp()
          if (existing) {
            Object.assign(existing, { price: body.price, source: body.source ?? 'manual', provenance: body.provenance ?? null, updatedAt: now })
            return { id: existing.id }
          }
          const id = randomId()
          w.prices.push({ id, instrumentId: inst.id, externalId: body.externalId ?? null, price: body.price, currency: inst.quoteCurrency, effectiveDate, source: body.source ?? 'manual', provenance: body.provenance ?? null, createdAt: now, updatedAt: now })
          return { id }
        }, idempotencyKey),
      remove: (id) =>
        write((w) => {
          w.prices = w.prices.filter((p) => p.id !== id)
        }),
    },

    positionEvents: {
      get: (accountId, id) =>
        read((e) => {
          const p = e.events(accountId).find((x) => x.id === id)
          if (!p) throw notFound('trade')
          return {
            id: p.id,
            accountId: p.accountId,
            instrumentId: p.instrumentId,
            type: p.type,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
            tradeCurrency: p.tradeCurrency,
            feeAmountMinor: p.feeMinor.toString(),
            cashEffectMinor: p.cashEffectMinor.toString(),
            tradeDate: p.date,
            eventSequence: p.seq,
            description: p.description,
            notes: p.notes,
            createdAt: p.createdAt,
            updatedAt: p.createdAt,
          }
        }),
      update: (id, body) =>
        write((w) => {
          const p = w.positionEvents.find((x) => x.id === id)
          if (!p) throw notFound('trade')
          Object.assign(p, { quantity: body.quantity, unitPrice: body.unitPrice ?? p.unitPrice, date: body.tradeDate, description: body.description, notes: body.notes })
          return { id }
        }),
      create: (body) =>
        write((w, e) => {
          const a = findAccount(w, body.accountId)
          if (a.trackingMode !== 'positions') throw invalid('Trades can only be recorded on position-tracked accounts.')
          const inst = w.instruments.find((i) => i.id === body.instrumentId)
          if (!inst) throw invalid('Choose an instrument.', { instrumentId: 'Required' })
          if (body.tradeDate > e.today) throw invalid('Trades cannot be in the future.', { tradeDate: 'Choose today or earlier' })
          if (toScaled(body.quantity) <= 0n) throw invalid('Enter a quantity greater than zero.', { quantity: 'Must be greater than zero' })
          const held = e.quantitiesAt(a.id, body.tradeDate).get(inst.id) ?? 0n
          if (body.type === 'sell' && toScaled(body.quantity) > held) {
            const heldText = fromScaled(held, 8)
            throw problem(
              422,
              'Not enough units',
              `You hold ${heldText} ${inst.symbol ?? inst.name} in this account on ${body.tradeDate}, so you can't sell ${body.quantity}.`,
              'https://wealthboard.dev/problems/insufficient-quantity',
              { quantity: `At most ${heldText}` },
            )
          }
          const price = body.unitPrice ?? '0'
          let gross = mulToMinor(body.quantity, price, inst.quoteCurrency)
          if (inst.quoteCurrency !== a.currency) {
            const converted = body.appliedExchangeRate
              ? convertMinor(gross, inst.quoteCurrency, a.currency, body.appliedExchangeRate)
              : e.convert(gross, inst.quoteCurrency, a.currency, body.tradeDate)
            if (converted === null) throw invalid(`Add a ${inst.quoteCurrency}/${a.currency} rate or enter the applied rate.`, { appliedExchangeRate: 'Required' })
            gross = converted
          }
          const fee = body.feeAmount ? majorToMinor(body.feeAmount, a.currency) : 0n
          const cash = body.type === 'buy' ? -(gross + fee) : body.type === 'sell' ? gross - fee : 0n
          const id = randomId()
          w.positionEvents.push({
            id,
            accountId: a.id,
            instrumentId: inst.id,
            type: body.type,
            quantity: body.quantity,
            unitPrice: price,
            tradeCurrency: inst.quoteCurrency,
            feeMinor: fee,
            cashEffectMinor: cash,
            date: body.tradeDate,
            seq: w.seq++,
            description: body.description ?? `${body.type === 'buy' ? 'Bought' : 'Sold'} ${body.quantity} ${inst.symbol ?? inst.name}`,
            notes: body.notes,
            createdAt: nowStamp(),
          })
          return { id }
        }, body.idempotencyKey),
      remove: (id) =>
        write((w) => {
          w.positionEvents = w.positionEvents.filter((p) => p.id !== id)
        }),
    },

    reconciliations: {
      list: (_accountId, q) => read(() => ({ items: [], limit: q?.limit ?? 50, offset: q?.offset ?? 0, hasMore: false })),
      create: async () => {
        await delay()
        throw unsupported('Reconciling to a broker statement')
      },
      remove: async () => {
        await delay()
        throw unsupported('Reconciliations')
      },
    },

    conversions: {
      preview: async () => {
        await delay()
        throw unsupported('Converting an account to positions')
      },
      execute: async () => {
        await delay()
        throw unsupported('Converting an account to positions')
      },
    },

    corporateActions: {
      create: async () => {
        await delay()
        throw unsupported('Corporate actions')
      },
      remove: async () => {
        await delay()
        throw unsupported('Corporate actions')
      },
    },

    estate: {
      get: () =>
        read((e, w) => {
          const side = sideFor(w)
          return buildWorkspace(side, e.accounts('all'), e.totalsAt(e.today).complete)
        }),
      updatePlan: (body) =>
        write((w) => {
          const side = sideFor(w)
          const now = nowStamp()
          side.plan = {
            id: side.plan?.id ?? randomId(),
            title: body.title,
            jurisdiction: body.jurisdiction ?? null,
            lastReviewedDate: body.lastReviewedDate ? `${body.lastReviewedDate}T00:00:00Z` : null,
            reviewReminderDate: body.reviewReminderDate ? `${body.reviewReminderDate}T00:00:00Z` : null,
            createdAt: side.plan?.createdAt ?? now,
            updatedAt: now,
          }
          return side.plan
        }),
      createBeneficiary: (body) =>
        write((w) => {
          const id = randomId()
          const now = nowStamp()
          sideFor(w).beneficiaries.push({ id, kind: body.kind, name: body.name, relationship: body.relationship ?? null, contactSummary: body.contactSummary ?? null, notes: body.notes ?? null, archivedAt: null, createdAt: now, updatedAt: now })
          return { id }
        }),
      updateBeneficiary: (id, body) =>
        write((w) => {
          const b = sideFor(w).beneficiaries.find((x) => x.id === id)
          if (!b) throw notFound('beneficiary')
          Object.assign(b, { kind: body.kind, name: body.name, relationship: body.relationship ?? null, contactSummary: body.contactSummary ?? null, notes: body.notes ?? null, updatedAt: nowStamp() })
        }),
      setBeneficiaryArchived: (id, archived) =>
        write((w) => {
          const b = sideFor(w).beneficiaries.find((x) => x.id === id)
          if (!b) throw notFound('beneficiary')
          b.archivedAt = archived ? nowStamp() : null
        }),
      upsertDirective: (accountId, body) =>
        write((w) => {
          findAccount(w, accountId)
          const side = sideFor(w)
          if (!side.plan) throw invalid('Save the plan details first.')
          const now = nowStamp()
          const existing = side.directives.find((d) => d.accountId === accountId)
          const next = {
            id: existing?.id ?? randomId(),
            estatePlanId: side.plan.id,
            accountId,
            isIncluded: body.isIncluded,
            ownershipShareBps: body.ownershipShareBps,
            transferContext: body.transferContext,
            distributionMethod: body.distributionMethod,
            documentReference: body.documentReference ?? null,
            notes: body.notes ?? null,
            reviewedAt: body.reviewedAt ? `${body.reviewedAt}T00:00:00Z` : null,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          }
          side.directives = [...side.directives.filter((d) => d.accountId !== accountId), next]
          return { id: next.id }
        }),
      upsertAllocation: (directiveId, body) =>
        write((w) => {
          const side = sideFor(w)
          if (!side.directives.some((d) => d.id === directiveId)) throw notFound('directive')
          const now = nowStamp()
          const existing = side.allocations.find((a) => a.directiveId === directiveId && a.beneficiaryId === body.beneficiaryId && a.tier === body.tier)
          if (existing) {
            Object.assign(existing, { allocationBps: body.allocationBps, notes: body.notes ?? null, updatedAt: now })
            return { id: existing.id }
          }
          const id = randomId()
          side.allocations.push({ id, estatePlanId: side.plan!.id, directiveId, beneficiaryId: body.beneficiaryId, tier: body.tier, allocationBps: body.allocationBps, notes: body.notes ?? null, createdAt: now, updatedAt: now })
          return { id }
        }),
      removeAllocation: (id) =>
        write((w) => {
          const side = sideFor(w)
          side.allocations = side.allocations.filter((a) => a.id !== id)
        }),
      upsertResiduary: (body) =>
        write((w) => {
          const side = sideFor(w)
          if (!side.plan) throw invalid('Save the plan details first.')
          const now = nowStamp()
          const existing = side.residuary.find((a) => a.beneficiaryId === body.beneficiaryId && a.tier === body.tier)
          if (existing) {
            Object.assign(existing, { allocationBps: body.allocationBps, notes: body.notes ?? null, updatedAt: now })
            return { id: existing.id }
          }
          const id = randomId()
          side.residuary.push({ id, estatePlanId: side.plan.id, beneficiaryId: body.beneficiaryId, tier: body.tier, allocationBps: body.allocationBps, notes: body.notes ?? null, createdAt: now, updatedAt: now })
          return { id }
        }),
      removeResiduary: (id) =>
        write((w) => {
          const side = sideFor(w)
          side.residuary = side.residuary.filter((a) => a.id !== id)
        }),
      createSnapshot: () =>
        write((w, e) => {
          const side = sideFor(w)
          if (!side.plan) throw invalid('Save the plan details first.')
          const workspace = buildWorkspace(side, e.accounts('all'), e.totalsAt(e.today).complete)
          const snapshot: EstateSnapshot = {
            id: randomId(),
            estatePlanId: side.plan.id,
            version: side.snapshots.length + 1,
            title: side.plan.title,
            valueAsOfDate: `${e.today}T00:00:00Z`,
            baseCurrency: w.settings.baseCurrency,
            contentHash: Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(i * 7 + side.snapshots.length) % 16]).join(''),
            generatedAt: nowStamp(),
            content: JSON.parse(JSON.stringify(workspace)),
          }
          side.snapshots.unshift(snapshot)
          return snapshot
        }),
      getSnapshot: (id) =>
        read((_e, w) => {
          const snap = sideFor(w).snapshots.find((x) => x.id === id)
          if (!snap) throw notFound('snapshot')
          return snap
        }),
      removeSnapshot: (id) =>
        write((w) => {
          const side = sideFor(w)
          side.snapshots = side.snapshots.filter((x) => x.id !== id)
        }),
    },

    ai: {
      get: () => read((_e, w) => sideFor(w).ai, { allowInErrorScenario: true }),
      saveSettings: async () => {
        await delay()
        throw unsupported('Connecting an AI provider')
      },
      disconnect: async () => {
        await delay()
        throw unsupported('AI settings')
      },
      saveCredential: async () => {
        await delay()
        throw unsupported('Storing an AI provider key')
      },
      removeCredential: async () => {
        await delay()
        throw unsupported('AI provider keys')
      },
      clearUsage: () => write(() => ({ deleted: 0 })),
      convertImport: async () => {
        await delay()
        throw unsupported('AI-assisted import')
      },
    },

    apiKeys: {
      list: () => read((_e, w) => sideFor(w).apiKeys.filter((k) => !k.revokedAt)),
      create: (body) =>
        write((w) => {
          const name = body.name.trim()
          if (!name) throw invalid('Name the key.', { name: 'Required' })
          const key = newApiKey(name, body.scopes ?? ['portfolio:read'], body.expiresAt)
          const { token: _token, ...meta } = key
          sideFor(w).apiKeys.unshift(meta)
          return key
        }),
      revoke: (id) =>
        write((w) => {
          const k = sideFor(w).apiKeys.find((x) => x.id === id)
          if (!k) throw notFound('API key')
          k.revokedAt = nowStamp()
        }),
      revokeAll: () =>
        write((w) => {
          const active = sideFor(w).apiKeys.filter((k) => !k.revokedAt)
          active.forEach((k) => (k.revokedAt = nowStamp()))
          return { revoked: active.length }
        }),
    },

    connectedApps: {
      list: () => read((_e, w) => sideFor(w).connectedApps),
      revoke: (id) =>
        write((w) => {
          const side = sideFor(w)
          if (!side.connectedApps.some((a) => a.id === id)) throw notFound('connected app')
          side.connectedApps = side.connectedApps.filter((a) => a.id !== id)
        }),
      clearCalls: (id) =>
        write((w) => {
          const app = sideFor(w).connectedApps.find((a) => a.id === id)
          if (!app) throw notFound('connected app')
          app.recentCalls = []
        }),
    },

    oauth: {
      request: async () => {
        await delay()
        throw unsupported('Connecting an AI assistant')
      },
      approve: async () => {
        await delay()
        throw unsupported('Connecting an AI assistant')
      },
      deny: async () => {
        await delay()
        throw unsupported('Connecting an AI assistant')
      },
    },

    goals: {
      list: () => read((e, w) => [...w.goals].sort((a, b) => a.priority - b.priority).map((g) => e.toGoal(g))),
      get: (id) =>
        read((e, w) => {
          const g = w.goals.find((x) => x.id === id)
          if (!g) throw notFound('goal')
          return e.toGoal(g)
        }),
      create: (body, { idempotencyKey }) =>
        write((w) => {
          const id = randomId()
          w.goals.push({
            id,
            name: body.name.trim(),
            description: body.description ?? null,
            targetMinor: majorToMinor(body.targetAmount, body.currency),
            manualCurrentMinor: body.currentAmount ? majorToMinor(body.currentAmount, body.currency) : 0n,
            currency: body.currency,
            targetDate: body.targetDate,
            linkedAccountId: body.linkedAccountId ?? null,
            icon: body.icon ?? 'target',
            status: body.status ?? 'active',
            priority: body.priority ?? w.goals.length + 1,
            assumedAnnualReturnBps: percentToBps(String(body.assumedAnnualReturn)),
            plannedContributionMinor: majorToMinor(body.plannedContribution, body.currency),
            frequency: body.frequency ?? 'monthly',
            planStartDate: body.planStartDate,
            planEndDate: body.planEndDate ?? null,
          })
          return { id, replayed: false }
        }, idempotencyKey),
      update: (id, body) =>
        write((w) => {
          const g = w.goals.find((x) => x.id === id)
          if (!g) throw notFound('goal')
          Object.assign(g, {
            name: body.name.trim(),
            description: body.description ?? null,
            targetMinor: majorToMinor(body.targetAmount, body.currency),
            manualCurrentMinor: body.currentAmount ? majorToMinor(body.currentAmount, body.currency) : g.manualCurrentMinor,
            targetDate: body.targetDate,
            linkedAccountId: body.linkedAccountId ?? null,
            icon: body.icon ?? g.icon,
            assumedAnnualReturnBps: percentToBps(String(body.assumedAnnualReturn)),
            plannedContributionMinor: majorToMinor(body.plannedContribution, body.currency),
            frequency: body.frequency ?? g.frequency,
          })
        }),
      remove: (id) =>
        write((w) => {
          w.goals = w.goals.filter((g) => g.id !== id)
          w.milestones = w.milestones.filter((m) => m.goalId !== id)
        }),
      setStatus: (id, status) =>
        write((w) => {
          const g = w.goals.find((x) => x.id === id)
          if (!g) throw notFound('goal')
          g.status = status
        }),
      scenarios: (id, params) =>
        read((e, w) => {
          const g = w.goals.find((x) => x.id === id)
          if (!g) throw notFound('goal')
          return e.goalScenarios(g, {
            monthly: BigInt(params.monthlyContributionMinor),
            bps: params.annualReturnBps,
          })
        }),
      milestones: (id) =>
        read((e, w) => {
          if (!w.goals.some((g) => g.id === id)) throw notFound('goal')
          return e.milestones(id)
        }),
      createMilestone: (id, body) =>
        write((w) => {
          const g = w.goals.find((x) => x.id === id)
          if (!g) throw notFound('goal')
          const mid = randomId()
          w.milestones.push({ id: mid, goalId: id, name: body.name, targetMinor: majorToMinor(body.targetAmount, g.currency), targetDate: body.targetDate ?? null })
          return { id: mid }
        }),
      removeMilestone: (id, milestoneId) =>
        write((w) => {
          w.milestones = w.milestones.filter((m) => !(m.goalId === id && m.id === milestoneId))
        }),
      alerts: () => read((e) => e.alerts()),
      dismissAlert: (id) =>
        write((w, e) => {
          w.dismissedAlerts.add(e.alertKey(id))
        }),
    },

    reports: {
      summary: () => read((e) => e.reportSummary()),
      allocation: () => read((e) => e.reportAllocation()),
      flows: (range) => read((e) => e.flowsReport(range)),
      income: (range) => read((e) => e.incomeReport(range)),
      netWorthStats: () => read((e) => e.netWorthStats()),
      accountComparison: (range) => read((e) => e.accountComparison(range)),
      attention: () => read((e) => e.attention()),
    },

    settings: {
      get: () => read((e) => e.settingsRead(getScenario().auth !== 'oidc'), { allowInErrorScenario: true }),
      update: (body) =>
        write((w) => {
          w.settings = {
            ...w.settings,
            displayName: body.displayName,
            appName: body.appName,
            baseCurrency: body.baseCurrency,
            supportedCurrencies: body.supportedCurrencies ?? w.settings.supportedCurrencies,
            timezone: body.timezone,
            preferredDateFormat: body.preferredDateFormat,
            defaultDashboardPeriod: body.defaultDashboardPeriod,
            sessionTimeoutMinutes: body.sessionTimeoutMinutes,
            defaultGoalReturnBps: body.defaultGoalReturnBps ?? w.settings.defaultGoalReturnBps,
            positionStaleDaysStock: body.positionStaleDaysStock,
            positionStaleDaysEtf: body.positionStaleDaysEtf,
            positionStaleDaysFund: body.positionStaleDaysFund,
            updatedAt: nowStamp(),
          }
        }),
    },

    categories: {
      list: () => read((_e, w) => [...w.categories].sort((a, b) => a.displayOrder - b.displayOrder)),
      create: (body) =>
        write((w) => {
          if (w.categories.some((c) => c.name.toLowerCase() === body.name.trim().toLowerCase())) {
            throw problem(409, 'Name already used', `A category called “${body.name}” already exists.`, 'https://wealthboard.dev/problems/conflict', { name: 'Already used' })
          }
          const c: Category = {
            id: randomId(),
            name: body.name.trim(),
            slug: body.name.trim().toLowerCase().replace(/[^a-z]+/g, '-'),
            icon: body.icon,
            displayOrder: w.categories.length + 1,
            assetOrLiability: body.assetOrLiability,
            description: body.description,
            isLiquid: body.isLiquid ?? false,
            isInvestible: body.isInvestible ?? false,
            isArchived: false,
            isSystem: false,
          }
          w.categories.push(c)
          return c
        }),
      update: (id, body) =>
        write((w) => {
          const c = w.categories.find((x) => x.id === id)
          if (!c) throw notFound('category')
          Object.assign(c, { name: body.name.trim(), icon: body.icon, assetOrLiability: body.assetOrLiability, description: body.description, isLiquid: !!body.isLiquid, isInvestible: !!body.isInvestible })
        }),
      setArchived: (id, archived) =>
        write((w) => {
          const c = w.categories.find((x) => x.id === id)
          if (!c) throw notFound('category')
          if (archived && w.accounts.some((a) => a.categoryId === id && !a.archivedAt)) {
            throw problem(409, 'Category in use', 'Move or archive the accounts in this category first.', 'https://wealthboard.dev/problems/conflict')
          }
          c.isArchived = archived
        }),
      reorder: (id, direction) =>
        write((w) => {
          const list = [...w.categories].sort((a, b) => a.displayOrder - b.displayOrder)
          const i = list.findIndex((c) => c.id === id)
          const j = direction === 'up' ? i - 1 : i + 1
          if (i < 0 || j < 0 || j >= list.length) return
          const a = list[i]!
          const b = list[j]!
          ;[a.displayOrder, b.displayOrder] = [b.displayOrder, a.displayOrder]
        }),
    },

    institutions: {
      list: () => read((_e, w) => [...w.institutions].sort((a, b) => a.name.localeCompare(b.name))),
      create: (body) =>
        write((w) => {
          const id = randomId()
          w.institutions.push({ id, name: body.name.trim(), type: body.type, websiteUrl: body.websiteUrl, countryCode: body.countryCode, address: body.address, notes: body.notes })
          return { id }
        }),
      update: (id, body) =>
        write((w) => {
          const inst = w.institutions.find((x) => x.id === id)
          if (!inst) throw notFound('institution')
          Object.assign(inst, body)
        }),
      setArchived: (id, archived) =>
        write((w) => {
          const inst = w.institutions.find((x) => x.id === id)
          if (!inst) throw notFound('institution')
          inst.archivedAt = archived ? nowStamp() : undefined
        }),
    },

    exchangeRates: {
      create: (body, { idempotencyKey }) =>
        write((w, e) => {
          if (body.baseCurrency === body.quoteCurrency) throw invalid('Choose two different currencies.', { quoteCurrency: 'Must differ' })
          if (body.effectiveDate > e.today) throw invalid('Rates cannot be in the future.', { effectiveDate: 'Choose today or earlier' })
          const effectiveDate = `${body.effectiveDate}T00:00:00Z`
          const dup = w.rates.find(
            (r) =>
              r.effectiveDate === effectiveDate &&
              ((r.baseCurrency === body.baseCurrency && r.quoteCurrency === body.quoteCurrency) || (r.baseCurrency === body.quoteCurrency && r.quoteCurrency === body.baseCurrency)),
          )
          if (dup) {
            throw problem(409, 'Rate already recorded', `There is already a ${dup.baseCurrency}/${dup.quoteCurrency} rate for ${body.effectiveDate}. Delete it first to replace it.`, 'https://wealthboard.dev/problems/conflict', {
              effectiveDate: 'Already has a rate',
            })
          }
          const rate = { id: randomId(), baseCurrency: body.baseCurrency, quoteCurrency: body.quoteCurrency, rate: body.rate, effectiveDate, source: 'manual', createdAt: nowStamp() }
          w.rates.push(rate)
          return rate
        }, idempotencyKey),
      remove: (id) =>
        write((w) => {
          w.rates = w.rates.filter((r) => r.id !== id)
        }),
    },

    imports: {
      async previewInvestmentHistory() {
        await delay()
        throw unsupported('Investment history import')
      },
      async commitInvestmentHistory() {
        await delay()
        throw unsupported('Investment history import')
      },
      async previewAccountHistory(accountId, file) {
        const hash = await sha256(file.content)
        return read((e) => buildImportResult(e, accountId, file, hash, false))
      },
      async commitAccountHistory(accountId, file, hash) {
        const actual = await sha256(file.content)
        if (actual !== hash) throw problem(409, 'File changed', 'The file differs from the one you previewed. Preview it again before importing.', 'https://wealthboard.dev/problems/preview-mismatch')
        return write((w, e) => {
          const result = buildImportResult(e, accountId, file, hash, true)
          for (const r of result.rows) {
            if (r.status !== 'imported' || !r.amount || !r.date || !r.type) continue
            const a = findAccount(w, accountId)
            const minor = majorToMinor(r.amount.replace('-', ''), a.currency)
            const id = stableId(`import:${hash}:${r.row}`)
            r.transactionId = id
            w.transactions.push({ id, accountId, type: r.type as never, amountMinor: minor, date: r.date, seq: w.seq++, externalId: r.externalId ?? undefined, description: 'Imported', createdAt: nowStamp() })
          }
          return result
        })
      },
    },

    exports: {
      async restoreFile(file) {
        const text = await file.text()
        let archive: UserArchive
        try {
          archive = JSON.parse(text) as UserArchive
        } catch {
          throw invalid('This file is not valid JSON.')
        }
        return this.restore(archive)
      },
      userArchive: () => read((e, w) => buildArchive(e, w)),
      transactionsCsv: () =>
        read((e, w) => {
          const rows = [['date', 'account', 'type', 'amount', 'currency', 'description', 'external_id']]
          for (const t of [...w.transactions].sort((a, b) => (a.date < b.date ? -1 : 1))) {
            const a = e.account(t.accountId)!
            rows.push([t.date, a.name, t.type, e.minorToMajor(t.amountMinor, a.currency), a.currency, t.description ?? '', t.externalId ?? ''])
          }
          return toCsv(rows)
        }),
      accountsCsv: () =>
        read((e) => {
          const rows = [['name', 'category', 'institution', 'currency', 'tracking_mode', 'current_value', 'converted_value', 'archived']]
          for (const a of e.accounts('all')) {
            rows.push([
              a.name,
              a.categoryName,
              a.institutionName ?? '',
              a.currency,
              a.trackingMode,
              e.minorToMajor(BigInt(a.currentValueMinor), a.currency),
              a.convertedValueMinor === null ? '' : e.minorToMajor(BigInt(a.convertedValueMinor), e.base),
              a.archivedAt ? 'yes' : 'no',
            ])
          }
          return toCsv(rows)
        }),
      restore: (archive) =>
        write(() => {
          if (archive.format !== 'wealthboard-user-json') throw invalid('This file is not a Wealthboard portfolio export.')
          return {
            institutions: archive.institutions.length,
            accounts: archive.accounts.length,
            transactions: archive.transactions.length,
            goals: archive.goals.length,
            milestones: archive.goalMilestones.length,
            beneficiaries: archive.beneficiaries.length,
            estatePlans: archive.estatePlans.length,
            estateSnapshots: archive.estatePlanSnapshots.length,
            investmentInstruments: archive.investmentInstruments.length,
            positionEvents: archive.positionEvents.length,
            securityPrices: archive.securityPrices.length,
            positionReconciliations: archive.positionReconciliations.length,
          }
        }),
    },
  }
}

function buildImportResult(e: Engine, accountId: string, file: Parameters<typeof parseImport>[0], hash: string, commit: boolean): AccountHistoryImportResult {
  const a = e.account(accountId)
  if (!a) throw notFound('account')
  if (a.trackingMode !== 'balance') throw invalid('Direct history import supports value-tracked accounts. Investment import is coming soon.')
  let parsed
  try {
    parsed = parseImport(file)
  } catch (err) {
    throw invalid(err instanceof Error ? err.message : 'The file could not be read.')
  }
  const existing = new Set(e.txns(accountId).flatMap((t) => (t.externalId ? [t.externalId] : [])))
  const current = e.valueAt(accountId, e.today).value
  const evaluated = evaluateImport(parsed, { currency: a.currency, existingExternalIds: existing, currentBalance: current, today: e.today })
  const rows = evaluated.rows.map((r) => (commit && r.status === 'ready' ? { ...r, status: 'imported', message: 'Imported.' } : r))
  const ready = rows.filter((r) => r.status === 'ready' || r.status === 'imported').length
  return {
    hash,
    account: { id: a.id, name: a.name, institution: e.world.institutions.find((i) => i.id === a.institutionId)?.name, currency: a.currency },
    dateRange: evaluated.range,
    currentBalanceMinor: Number(current),
    projectedBalanceMinor: Number(current + evaluated.net),
    finalBalanceMinor: commit ? Number(current + evaluated.net) : undefined,
    netChangeMinor: Number(evaluated.net),
    summary: {
      ready: commit ? undefined : ready,
      imported: commit ? ready : undefined,
      skippedDuplicates: rows.filter((r) => r.status === 'duplicate').length,
      failed: rows.filter((r) => r.status === 'error').length,
    },
    rows,
  }
}

function buildArchive(e: Engine, w: World): UserArchive {
  const rec = <T extends object>(o: T) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Record<string, unknown>
  return {
    format: 'wealthboard-user-json',
    version: 8,
    exportedAt: new Date().toISOString(),
    settings: rec(w.settings),
    categories: w.categories.map(rec),
    institutions: w.institutions.map(rec),
    accounts: w.accounts.map(rec),
    transactions: w.transactions.map(rec),
    valuations: w.valuations.map(rec),
    exchangeRates: w.rates.map(rec),
    goals: w.goals.map(rec),
    goalContributionPlans: [],
    goalMilestones: w.milestones.map(rec),
    goalAlertDismissals: [...w.dismissedAlerts].map((k) => ({ alertKey: k })),
    beneficiaries: [],
    estatePlans: [],
    estateAccountDirectives: [],
    estateAllocations: [],
    estateResiduaryAllocations: [],
    estatePlanSnapshots: [],
    investmentInstruments: w.instruments.map(rec),
    positionEvents: w.positionEvents.map(rec),
    securityPrices: w.prices.map(rec),
    positionReconciliations: [],
    accountConversions: [],
  }
  void e
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'
}

export function today(): string {
  return todayISO()
}
