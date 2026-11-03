import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { RotateCw } from 'lucide-react'
import { Button, buttonClass } from '@/components/ui/Button'
import { BrandMark } from '@/features/shell/Brand'

/** Error boundary for every route: explains, offers reload and a way home. */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const message = isRouteErrorResponse(error) ? error.statusText : error instanceof Error ? error.message : 'Unknown error'
  return (
    <main className="grid min-h-[70dvh] place-items-center px-6 py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 w-fit opacity-80">
          <BrandMark size={40} />
        </div>
        <h1 className="display text-xl text-ink">{notFound ? 'This page does not exist' : 'Something broke on this screen'}</h1>
        <p className="mt-2 text-muted">
          {notFound ? 'The link may be old, or the item was deleted.' : 'Your data is safe. Reloading usually fixes this; if it keeps happening, the details below help with a bug report.'}
        </p>
        {!notFound ? <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-sunken p-3 text-left text-xs text-muted">{message}</pre> : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={<RotateCw size={16} aria-hidden />} onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Link to="/" className={buttonClass({ variant: 'secondary' })}>
            Go to Home
          </Link>
        </div>
      </div>
    </main>
  )
}
