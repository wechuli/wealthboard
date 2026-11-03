import { WifiOff } from 'lucide-react'
import { useOnline } from '@/lib/online'

/** Explains that fresh data needs the server and that changes are paused. */
export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div role="status" className="border-b border-warning/30 bg-warning-soft" data-no-print>
      <div className="mx-auto flex max-w-[calc(var(--content-max)+80px)] items-start gap-3 px-4 py-2.5 text-sm md:items-center md:px-6 lg:px-10">
        <WifiOff size={17} aria-hidden className="mt-0.5 shrink-0 text-warning md:mt-0" />
        <p className="text-ink">
          <span className="font-semibold">You're offline.</span> <span className="text-muted">You're seeing the last data loaded. Fresh numbers need the server, so recording is paused until you reconnect.</span>
        </p>
      </div>
    </div>
  )
}
