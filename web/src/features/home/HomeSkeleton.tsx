import { Skeleton } from '@/components/ui/Skeleton'

/** Loading placeholder shaped like the hero and the two panel columns. */
export function HomeSkeleton() {
  return (
    <div className="page" role="status" aria-label="Loading your overview">
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="card mt-8 grid overflow-hidden rounded-xl lg:grid-cols-[23rem_1fr]">
        <div className="flex flex-col gap-3 p-5 lg:border-r lg:border-line lg:p-7">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-64 max-w-full" />
          <Skeleton className="h-4 w-48" />
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="border-t border-line p-5 lg:border-t-0 lg:p-7">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="mt-4 h-56 md:h-[290px]" />
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
