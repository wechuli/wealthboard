import { AlertOctagon, AlertTriangle, Info, Scale } from 'lucide-react'
import { Link } from 'react-router'
import type { AIRead, AIReviewFinding } from '@/api/types'
import { DateText } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { buttonClass } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'

/** The standing "not financial advice" statement, shown wherever AI output is requested or read. */
export function AdviceNotice({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div role="note" aria-label="Not financial advice" className={cn('flex items-start gap-3 rounded-lg border border-line bg-sunken/50 px-4 py-3 text-sm', className)}>
      <Scale size={18} aria-hidden className="mt-px shrink-0 text-muted" />
      <p className="min-w-0 text-muted">
        <span className="font-semibold text-ink">Not financial advice.</span>{' '}
        {compact
          ? 'AI output explains your records; it doesn’t recommend products, trades, or tax decisions.'
          : 'A review explains what your own records show. It doesn’t recommend products, trades, or tax decisions, and it can be wrong. Check anything important against your statements, and with a qualified adviser before acting.'}
      </p>
    </div>
  )
}

const SEVERITY = {
  high: { label: 'High', tone: 'negative', icon: <AlertOctagon size={12} aria-hidden /> },
  attention: { label: 'Needs attention', tone: 'warning', icon: <AlertTriangle size={12} aria-hidden /> },
  info: { label: 'For information', tone: 'info', icon: <Info size={12} aria-hidden /> },
} as const

export function SeverityBadge({ severity }: { severity: AIReviewFinding['severity'] }) {
  const s = SEVERITY[severity]
  return (
    <Badge tone={s.tone} icon={s.icon}>
      <span className="sr-only">Severity: </span>
      {s.label}
    </Badge>
  )
}

const CONFIDENCE_LEVEL = { low: 1, medium: 2, high: 3 } as const

/** Three-step meter plus words, so the level is never conveyed by shape alone. */
export function Confidence({ confidence }: { confidence: AIReviewFinding['confidence'] }) {
  const level = CONFIDENCE_LEVEL[confidence]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className="inline-flex items-end gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('w-1 rounded-sm', i === 1 ? 'h-1.5' : i === 2 ? 'h-2.5' : 'h-3.5', i <= level ? 'bg-ink/70' : 'bg-line-strong/60')} />
        ))}
      </span>
      {confidence[0]?.toUpperCase()}
      {confidence.slice(1)} confidence
    </span>
  )
}

/** Why a review or conversion can't run right now (budget, cooldown, or another server reason). */
export function AvailabilityNotice({ availability: av, what = 'Reviews' }: { availability: AIRead['reviewAvailability']; what?: string }) {
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

