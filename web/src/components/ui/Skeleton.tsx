import { cn } from '@/lib/cn'

export function Skeleton({ className, label }: { className?: string; label?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden={label ? undefined : true} role={label ? 'status' : undefined} aria-label={label} />
}

/** A loading placeholder for a page: announces once, then shows shaped skeletons. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="page" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <Skeleton className="mt-4 h-72" />
    </div>
  )
}
