import { AlertTriangle, CheckCircle2, CircleDashed, MinusCircle } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { api } from '@/api'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { EstateWorkspace } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { formatBps } from '@/lib/money'
import { useAccounts, useEstate } from '@/lib/queries'
import { buildEstateView, describeTier, FULL_BPS, tierState, type AssetStatus, type EstateView } from './model'

/** The estate workspace joined with the user's active accounts. */
export function useEstateView() {
  const estate = useEstate()
  const accounts = useAccounts('active')
  const view = useMemo<EstateView | undefined>(() => (estate.data && accounts.data ? buildEstateView(estate.data, accounts.data) : undefined), [estate.data, accounts.data])
  return {
    view,
    isLoading: estate.isLoading || accounts.isLoading,
    error: estate.error ?? accounts.error,
    refetch: () => {
      void estate.refetch()
      void accounts.refetch()
    },
  }
}

/**
 * The server creates a default plan on first use; the mock requires one first. Creating it with the
 * server's default title keeps both paths identical.
 */
export async function ensurePlan(workspace: EstateWorkspace): Promise<void> {
  if (!workspace.plan) await api.estate.updatePlan({ title: 'My estate plan' })
}

export function ProblemNotice({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null
  const p = ApiProblem.is(error) ? error : null
  return (
    <Notice tone="negative" role="alert" title={title ?? p?.title ?? 'That did not save'}>
      {problemMessage(error)}
    </Notice>
  )
}

export function fieldError(error: unknown, field: string): string | undefined {
  return ApiProblem.is(error) ? error.fieldErrors?.[field] : undefined
}

/** Shaped loading state for the estate sections. */
export function EstateSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading estate plan" className="flex flex-col gap-4">
      <Skeleton className="h-28" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  )
}

/** A tier's allocated share as a meter plus words. Never colour alone: the label states the result. */
export function TierMeter({ totalBps, label, className, compact }: { totalBps: number; label: string; className?: string; compact?: boolean }) {
  const state = tierState(totalBps)
  const width = Math.min(totalBps, FULL_BPS) / 100
  const fill = state.kind === 'over' ? 'bg-negative' : state.kind === 'complete' ? 'bg-positive' : 'bg-accent'
  const Icon = state.kind === 'complete' ? CheckCircle2 : state.kind === 'over' ? AlertTriangle : CircleDashed
  const tone = state.kind === 'complete' ? 'text-positive' : state.kind === 'over' ? 'text-negative' : state.kind === 'under' ? 'text-warning' : 'text-subtle'
  return (
    <div className={cn('min-w-0', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={totalBps / 100}
        aria-valuetext={describeTier(state)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-[var(--dur-2)] ease-out', fill)} style={{ width: `${width}%` }} />
      </div>
      {compact ? null : (
        <p className={cn('mt-1.5 flex items-center gap-1.5 text-xs font-medium', tone)}>
          <Icon size={13} aria-hidden className="shrink-0" />
          <span className="num">{describeTier(state)}</span>
        </p>
      )}
    </div>
  )
}

export function TierFigure({ totalBps }: { totalBps: number }) {
  const state = tierState(totalBps)
  if (state.kind === 'empty') return <span className="text-subtle">—</span>
  return (
    <span className={cn('num font-medium', state.kind === 'complete' ? 'text-ink' : state.kind === 'over' ? 'text-negative' : 'text-warning')}>
      {formatBps(totalBps)}
    </span>
  )
}

const STATUS: Record<AssetStatus, { label: string; tone: 'neutral' | 'positive' | 'warning' | 'info' | 'negative'; icon: ReactNode }> = {
  excluded: { label: 'Excluded', tone: 'neutral', icon: <MinusCircle size={12} aria-hidden /> },
  unconfigured: { label: 'Needs a directive', tone: 'warning', icon: <CircleDashed size={12} aria-hidden /> },
  incomplete: { label: 'Incomplete', tone: 'warning', icon: <AlertTriangle size={12} aria-hidden /> },
  covered: { label: 'Covered by residue', tone: 'info', icon: <CheckCircle2 size={12} aria-hidden /> },
  complete: { label: 'Complete', tone: 'positive', icon: <CheckCircle2 size={12} aria-hidden /> },
}

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const s = STATUS[status]
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  )
}

/** A native checkbox with a 44px touch target. */
export function CheckboxRow({ label, description, checked, onChange, id }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange(next: boolean): void; id: string }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-sunken">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded-sm border-line-strong accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted">{description}</span> : null}
      </span>
    </label>
  )
}
