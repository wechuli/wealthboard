import { Scale } from 'lucide-react'
import { Link } from 'react-router'
import type { AIRead } from '@/api/types'
import { DateText } from '@/components/format'
import { buttonClass } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'

/** The standing "not financial advice" statement, shown wherever AI output is requested or read. */
export function AdviceNotice({ className }: { className?: string }) {
  return (
    <div role="note" aria-label="Not financial advice" className={cn('flex items-start gap-3 rounded-lg border border-line bg-sunken/50 px-4 py-3 text-sm', className)}>
      <Scale size={18} aria-hidden className="mt-px shrink-0 text-muted" />
      <p className="min-w-0 text-muted">
        <span className="font-semibold text-ink">Not financial advice.</span>{' '}
        AI output explains your records; it doesn’t recommend products, trades, or tax decisions.
      </p>
    </div>
  )
}

/** Why an AI conversion can't run right now (budget, cooldown, or another server reason). */
export function AvailabilityNotice({ availability: av, what = 'AI requests' }: { availability: AIRead['availability']; what?: string }) {
  if (av.available) return null
  if (av.reason === 'monthly_token_limit_reached')
    return (
      <Notice
        tone="warning"
        title="This month’s token budget is used up"
        action={
          <Link to="/settings/ai" className={buttonClass({ size: 'sm' })}>
            Raise the limit
          </Link>
        }
      >
        AI requests start again next month, or sooner if you raise your monthly limit or clear usage history in AI settings.
      </Notice>
    )
  if (av.reason === 'cooldown')
    return (
      <Notice tone="info" title="Taking a short break between requests">
        You’ve made several AI requests in the last minute.{' '}
        {av.cooldownUntil ? (
          <>
            You can request another at <DateText value={av.cooldownUntil} withTime />.
          </>
        ) : (
          'Try again in a minute.'
        )}
      </Notice>
    )
  return (
    <Notice tone="warning" title={`${what} aren’t available right now`} action={<Link to="/settings/ai" className={buttonClass({ size: 'sm' })}>Open AI settings</Link>}>
      {av.reason.includes(' ') ? av.reason : 'Check your AI provider settings, then try again.'}
    </Notice>
  )
}

