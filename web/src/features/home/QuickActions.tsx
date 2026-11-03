import { ArrowDownLeft, ArrowUpRight, Scale, ShoppingCart } from 'lucide-react'
import type { RecordAction } from '@/features/recording/recorder'
import { useRecorder } from '@/features/recording/recorder'
import { cn } from '@/lib/cn'

const ACTIONS: { action: RecordAction; label: string; icon: typeof Scale }[] = [
  { action: 'valuation', label: 'Update a value', icon: Scale },
  { action: 'deposit', label: 'Deposit', icon: ArrowDownLeft },
  { action: 'withdrawal', label: 'Withdrawal', icon: ArrowUpRight },
  { action: 'buy', label: 'Record a trade', icon: ShoppingCart },
]

/** Mobile-first shortcuts into the quick-add sheet. */
export function QuickActions({ className }: { className?: string }) {
  const recorder = useRecorder()
  return (
    <section aria-labelledby="quick-actions" className={cn('card p-4', className)}>
      <h2 id="quick-actions" className="text-md font-semibold text-ink">
        Record
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {ACTIONS.map(({ action, label, icon: Icon }) => (
          <button
            key={action}
            type="button"
            onClick={() => recorder.open({ action })}
            className="flex min-h-12 items-center gap-2.5 rounded-md border border-line bg-sunken/50 px-3 text-left text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <Icon size={17} aria-hidden strokeWidth={1.75} className="shrink-0 text-accent" />
            <span className="min-w-0">{label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
