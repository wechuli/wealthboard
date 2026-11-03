/** Dev-only mock scenarios. Persisted in localStorage so a reload keeps the chosen state. */
export type DataScenario = 'full' | 'empty' | 'incomplete' | 'slow' | 'errors'
export type AuthScenario = 'local' | 'oidc' | 'both'

export interface MockScenario {
  data: DataScenario
  auth: AuthScenario
}

const KEY = 'wealthboard-dev-scenario'
const DEFAULT: MockScenario = { data: 'full', auth: 'local' }

type Listener = (s: MockScenario) => void
const listeners = new Set<Listener>()

export function getScenario(): MockScenario {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Partial<MockScenario>
    return { ...DEFAULT, ...parsed }
  } catch {
    return DEFAULT
  }
}

export function setScenario(next: Partial<MockScenario>): MockScenario {
  const merged = { ...getScenario(), ...next }
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(merged))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(merged))
  return merged
}

export function onScenarioChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const DATA_SCENARIOS: { id: DataScenario; label: string; hint: string }[] = [
  { id: 'full', label: 'Full portfolio', hint: '30 months of history, 11 accounts, 6 goals' },
  { id: 'empty', label: 'New user (empty)', hint: 'First-run experience' },
  { id: 'incomplete', label: 'Incomplete data', hint: 'Missing USD/KES rate and a missing price' },
  { id: 'slow', label: 'Slow network', hint: '2.5–4 s latency on every request' },
  { id: 'errors', label: 'Errors', hint: 'Portfolio endpoints fail with problem+json' },
]

export const AUTH_SCENARIOS: { id: AuthScenario; label: string }[] = [
  { id: 'local', label: 'Local' },
  { id: 'oidc', label: 'OIDC only' },
  { id: 'both', label: 'Both' },
]
