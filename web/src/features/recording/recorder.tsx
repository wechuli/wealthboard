import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type RecordAction =
  | 'deposit'
  | 'withdrawal'
  | 'interest'
  | 'dividend'
  | 'fee'
  | 'valuation'
  | 'buy'
  | 'sell'
  | 'price'
  | 'transfer'
  | 'payment'
  | 'increase'
  | 'account'
  | 'goal'

export interface RecorderOpenOptions {
  action?: RecordAction
  /** Pre-selects this account (for example, when launched from an account page). */
  accountId?: string
  instrumentId?: string
}

interface RecorderContextValue {
  open(options?: RecorderOpenOptions): void
  close(): void
  isOpen: boolean
}

const RecorderContext = createContext<RecorderContextValue>({ open: () => {}, close: () => {}, isOpen: false })

const RecorderSheet = lazy(() => import('./RecorderSheet'))

/** Hosts the quick-add sheet. Any screen can open it with useRecorder().open({ action, accountId }). */
export function RecorderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; options: RecorderOpenOptions; nonce: number }>({ open: false, options: {}, nonce: 0 })
  const open = useCallback((options: RecorderOpenOptions = {}) => setState((s) => ({ open: true, options, nonce: s.nonce + 1 })), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  const value = useMemo(() => ({ open, close, isOpen: state.open }), [open, close, state.open])
  return (
    <RecorderContext.Provider value={value}>
      {children}
      {state.nonce > 0 ? (
        <Suspense fallback={null}>
          <RecorderSheet key={state.nonce} open={state.open} options={state.options} onOpenChange={(o) => (o ? undefined : close())} />
        </Suspense>
      ) : null}
    </RecorderContext.Provider>
  )
}

export function useRecorder(): RecorderContextValue {
  return useContext(RecorderContext)
}
