import { RotateCw, CloudOff } from 'lucide-react'
import { ApiProblem, problemMessage } from '@/api/problem'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

/** Designed error state for a failed query, showing problem+json details. */
export function ErrorState({ error, onRetry, title, compact }: { error: unknown; onRetry?: () => void; title?: string; compact?: boolean }) {
  const p = ApiProblem.is(error) ? error : null
  return (
    <EmptyState
      compact={compact}
      icon={<CloudOff size={22} aria-hidden />}
      title={title ?? p?.title ?? 'This could not be loaded'}
      action={
        onRetry ? (
          <Button onClick={onRetry} icon={<RotateCw size={16} aria-hidden />}>
            Try again
          </Button>
        ) : undefined
      }
    >
      <p>{problemMessage(error)}</p>
      {p && p.status > 0 ? <p className="mt-1 text-xs text-subtle">Error {p.status}</p> : null}
    </EmptyState>
  )
}
