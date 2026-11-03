import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PRIVACY_STORAGE_KEY } from '@/config'
import { browserStorage, writeStored } from './storage'

interface PrivacyContextValue {
  hidden: boolean
  setHidden(hidden: boolean): void
  toggle(): void
}

const PrivacyContext = createContext<PrivacyContextValue>({ hidden: false, setHidden: () => {}, toggle: () => {} })

export function readPrivacy(storage: Pick<Storage, 'getItem'> | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(PRIVACY_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHiddenState] = useState(readPrivacy)
  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next)
    writeStored(PRIVACY_STORAGE_KEY, String(next))
  }, [])
  useEffect(() => {
    document.documentElement.dataset.valuesHidden = String(hidden)
  }, [hidden])
  const value = useMemo(() => ({ hidden, setHidden, toggle: () => setHidden(!hidden) }), [hidden, setHidden])
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext)
}
