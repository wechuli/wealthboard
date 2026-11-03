import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { api } from '@/api'
import type { SessionResponse, SessionUser } from '@/api/types'

interface SessionContextValue {
  status: 'loading' | 'signed-in' | 'signed-out' | 'error'
  user: SessionUser | null
  error: Error | null
  /** Replaces the session after sign-in or sign-up, clearing any other user's cached data. */
  setSession(session: SessionResponse): void
  signOut(): Promise<void>
  retry(): void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export const SESSION_KEY = ['session'] as const

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: SESSION_KEY, queryFn: () => api.auth.session(), staleTime: Infinity, retry: 1 })
  const user = query.data?.user ?? null
  const previous = useRef<string | null>(null)

  // On any user switch, drop every cached query that belongs to someone else.
  useEffect(() => {
    const id = user?.id ?? null
    if (previous.current !== id) {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'u' && q.queryKey[1] !== id })
      previous.current = id
    }
  }, [user?.id, qc])

  const setSession = useCallback(
    (session: SessionResponse) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'u' })
      qc.setQueryData(SESSION_KEY, session)
    },
    [qc],
  )

  const signOut = useCallback(async () => {
    try {
      await api.auth.logout()
    } finally {
      // Notify the session observer first, then drop every other cached query (all user data).
      qc.setQueryData(SESSION_KEY, null)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] })
    }
  }, [qc])

  const value = useMemo<SessionContextValue>(
    () => ({
      status: query.isPending ? 'loading' : query.isError ? 'error' : user ? 'signed-in' : 'signed-out',
      user,
      error: query.error,
      setSession,
      signOut,
      retry: () => void query.refetch(),
    }),
    [query, user, setSession, signOut],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
