import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api'
import { isUnauthorized } from '@/api/problem'
import type { SessionResponse, SessionUser } from '@/api/types'

interface SessionContextValue {
  status: 'loading' | 'signed-in' | 'signed-out' | 'error'
  user: SessionUser | null
  error: Error | null
  /** True after the person signed out here (not an expired session), so no `next` page is kept. */
  signedOutByUser: boolean
  /** Replaces the session after sign-in or sign-up, clearing any other user's cached data. */
  setSession(session: SessionResponse): void
  /**
   * Revokes the server session, then clears local state. Rejects, leaving the person signed in,
   * when the server could not confirm the logout: the session cookie would otherwise stay valid.
   */
  signOut(): Promise<void>
  retry(): void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export const SESSION_KEY = ['session'] as const

const SESSION_CHANNEL = 'wealthboard-session'

function openSessionChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSION_CHANNEL) : null
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  // Revalidated on focus so a logout, expiry, or account switch elsewhere is noticed.
  const query = useQuery({ queryKey: SESSION_KEY, queryFn: () => api.auth.session(), staleTime: Infinity, retry: 1, refetchOnWindowFocus: 'always' })
  const user = query.data?.user ?? null
  const previous = useRef<string | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  const [signedOutByUser, setSignedOutByUser] = useState(false)

  // Any 401 means the session may have expired or been revoked: re-check it rather than keep
  // showing cached data. A null session then clears every user query (see the effect below).
  useEffect(() => {
    const revalidate = () => void qc.invalidateQueries({ queryKey: SESSION_KEY })
    const offQueries = qc.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error' && event.query.queryKey[0] !== SESSION_KEY[0] && isUnauthorized(event.action.error)) revalidate()
    })
    const offMutations = qc.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error' && isUnauthorized(event.action.error)) revalidate()
    })
    const bc = openSessionChannel()
    channel.current = bc
    if (bc) bc.onmessage = revalidate
    return () => {
      offQueries()
      offMutations()
      bc?.close()
      channel.current = null
    }
  }, [qc])

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
      setSignedOutByUser(false)
      qc.setQueryData(SESSION_KEY, session)
      channel.current?.postMessage('changed')
    },
    [qc],
  )

  const signOut = useCallback(async () => {
    try {
      await api.auth.logout()
    } catch (error) {
      // An already-invalid session is signed out; any other failure leaves the cookie valid.
      if (!isUnauthorized(error)) throw error
    }
    setSignedOutByUser(true)
    // Notify the session observer first, then drop every other cached query (all user data).
    qc.setQueryData(SESSION_KEY, null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] })
    channel.current?.postMessage('changed')
  }, [qc])

  const value = useMemo<SessionContextValue>(
    () => ({
      // A failed background re-check keeps the last known session; only a failed first load is an error.
      status: query.isPending ? 'loading' : query.data === undefined ? 'error' : user ? 'signed-in' : 'signed-out',
      user,
      error: query.error,
      signedOutByUser,
      setSession,
      signOut,
      retry: () => void query.refetch(),
    }),
    [query, user, setSession, signOut, signedOutByUser],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
