import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { buttonClass } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePageTitle } from '@/lib/usePageTitle'

export default function NotFoundPage() {
  usePageTitle('Not found')
  return (
    <div className="page">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={<Compass size={22} aria-hidden />}
        title="Nothing lives at this address"
        action={
          <>
            <Link to="/" className={buttonClass({ variant: 'primary' })}>
              Go to Home
            </Link>
            <Link to="/accounts" className={buttonClass()}>
              View accounts
            </Link>
          </>
        }
      >
        The link may be mistyped, or the account, goal, or instrument it pointed to was deleted.
      </EmptyState>
    </div>
  )
}
