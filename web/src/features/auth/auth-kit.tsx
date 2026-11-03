import { Skeleton } from '@/components/ui/Skeleton'

/** Only same-app paths are allowed as a post-sign-in destination (no open redirects, no auth loops). */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (value.startsWith('/sign-in') || value.startsWith('/sign-up')) return '/'
  return value
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-subtle" role="separator" aria-label="or">
      <span className="h-px flex-1 bg-line" />
      <span aria-hidden>or</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

export function AuthCardSkeleton() {
  return (
    <div className="card px-5 py-6 sm:px-7 sm:py-8" role="status" aria-label="Loading sign-in options">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="mt-2.5 h-4 w-60" />
      <div className="mt-7 flex flex-col gap-5">
        <div>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-2 h-10 w-full" />
        </div>
        <div>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-2 h-10 w-full" />
        </div>
        <Skeleton className="mt-1 h-12 w-full" />
      </div>
    </div>
  )
}
