import { Navigate, Outlet, useLocation } from 'react-router'
import { useSession } from '@/lib/session'
import { ErrorState } from '@/components/ui/ErrorState'
import { BrandMark } from '@/features/shell/Brand'

function Booting() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Starting Wealthboard">
      <div className="flex flex-col items-center gap-4 text-muted">
        <BrandMark size={40} />
        <div className="h-1 w-28 overflow-hidden rounded-full bg-sunken">
          <div className="skeleton h-full w-full" />
        </div>
      </div>
    </div>
  )
}

/** Renders protected routes only after the session bootstraps. */
export function RequireSession() {
  const { status, error, retry } = useSession()
  const location = useLocation()
  if (status === 'loading') return <Booting />
  if (status === 'error')
    return (
      <div className="grid min-h-dvh place-items-center">
        <ErrorState error={error} onRetry={retry} title="Wealthboard can't reach the server" />
      </div>
    )
  if (status === 'signed-out') {
    const next = location.pathname + location.search
    return <Navigate to={next && next !== '/' ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'} replace />
  }
  return <Outlet />
}

export function PublicOnly() {
  const { status } = useSession()
  const location = useLocation()
  if (status === 'loading') return <Booting />
  if (status === 'signed-in') {
    const next = new URLSearchParams(location.search).get('next')
    return <Navigate to={next && next.startsWith('/') ? next : '/'} replace />
  }
  return <Outlet />
}
