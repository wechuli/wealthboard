/** Building blocks shared by the settings sections: panels, save footers, problem rendering, and settings writes. */
import { ChevronDown, WifiOff } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { api } from '@/api'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { SettingsMutationRequest, SettingsRead, UserSettings } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useSettings } from '@/lib/queries'

/** One settings section: a single card with an h2, a short description, content, and an optional footer. */
export function SettingsPanel({
  title,
  description,
  action,
  children,
  footer,
  className,
  bodyClassName,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('card', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-5 md:px-6 md:pt-6">
        <div className="min-w-0 max-w-[62ch]">
          <h2 id={id} className="text-md font-semibold text-ink">
            {title}
          </h2>
          {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </header>
      {children !== undefined && children !== null ? <div className={cn('px-5 pb-5 pt-5 md:px-6 md:pb-6', bodyClassName)}>{children}</div> : <div className="h-5 md:h-6" />}
      {footer ? <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-line px-5 py-3.5 md:px-6">{footer}</div> : null}
    </section>
  )
}

/** Stack of settings panels with consistent rhythm. */
export function SettingsStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5 md:gap-6">{children}</div>
}

/** Left side of a save footer: offline reason, unsaved hint, or nothing. */
export function SaveStatus({ dirty }: { dirty: boolean }) {
  const online = useOnline()
  if (!online)
    return (
      <p className="mr-auto inline-flex items-center gap-1.5 text-xs text-warning">
        <WifiOff size={14} aria-hidden />
        {OFFLINE_REASON}
      </p>
    )
  return (
    <p className="mr-auto text-xs text-muted" aria-live="polite">
      {dirty ? 'You have unsaved changes.' : ''}
    </p>
  )
}

/** Save footer for a settings form: status on the left, a submit button that is disabled offline or when nothing changed. */
export function SaveFooter({ pending, dirty, label = 'Save changes' }: { pending: boolean; dirty: boolean; label?: string }) {
  const online = useOnline()
  return (
    <>
      <SaveStatus dirty={dirty} />
      <Button type="submit" variant="primary" loading={pending} disabled={!online || !dirty} title={!online ? OFFLINE_REASON : undefined}>
        {label}
      </Button>
    </>
  )
}

/** The server's problem detail, rendered above a form. */
export function ProblemNotice({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null
  const title = ApiProblem.is(error) ? error.title : 'Something went wrong'
  return (
    <Notice tone="negative" role="alert" title={title} className={className}>
      {problemMessage(error)}
    </Notice>
  )
}

/** Copies ApiProblem.fieldErrors onto the matching form fields (the server stays authoritative). */
export function applyFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly string[], aliases: Record<string, string> = {}): void {
  if (!ApiProblem.is(error) || !error.fieldErrors) return
  let first = true
  for (const [rawKey, message] of Object.entries(error.fieldErrors)) {
    const key = aliases[rawKey] ?? rawKey
    if (!fields.includes(key)) continue
    setError(key as Path<T>, { type: 'server', message }, { shouldFocus: first })
    first = false
  }
}

/** Builds the full settings object the API expects, merging a partial change into the current values. */
export function buildSettingsRequest(s: UserSettings, patch: Partial<SettingsMutationRequest>): SettingsMutationRequest {
  return {
    displayName: s.displayName,
    appName: s.appName,
    baseCurrency: s.baseCurrency,
    supportedCurrencies: s.supportedCurrencies,
    timezone: s.timezone,
    preferredDateFormat: s.preferredDateFormat as SettingsMutationRequest['preferredDateFormat'],
    defaultDashboardPeriod: s.defaultDashboardPeriod as SettingsMutationRequest['defaultDashboardPeriod'],
    sessionTimeoutMinutes: s.sessionTimeoutMinutes,
    defaultGoalReturnBps: s.defaultGoalReturnBps,
    positionStaleDaysStock: s.positionStaleDaysStock,
    positionStaleDaysEtf: s.positionStaleDaysEtf,
    positionStaleDaysFund: s.positionStaleDaysFund,
    ...patch,
  }
}

/** Saves part of the settings. Errors are rendered by the form (field errors plus a notice), not toasted. */
export function useSaveSettings(success: string, onSuccess?: (patch: Partial<SettingsMutationRequest>) => void) {
  const { data } = useSettings()
  return useApiMutation<Partial<SettingsMutationRequest>, void>({
    mutationFn: async (patch) => {
      if (!data) throw new ApiProblem({ type: 'about:blank', title: 'Settings not loaded', status: 0, detail: 'Your settings are still loading. Try again in a moment.' })
      return api.settings.update(buildSettingsRequest(data.settings, patch))
    },
    success,
    toastError: false,
    onSuccess: (_r, patch) => onSuccess?.(patch),
  })
}

/** Renders children once settings load, with a shaped skeleton and a designed error state. */
export function WithSettings({ children, panels = 1 }: { children: (data: SettingsRead) => ReactNode; panels?: number }) {
  const { data, error, isPending, refetch } = useSettings()
  if (isPending) return <PanelsSkeleton panels={panels} />
  if (error || !data)
    return (
      <div className="card">
        <ErrorState error={error} onRetry={() => void refetch()} title="Settings could not be loaded" />
      </div>
    )
  return <>{children(data)}</>
}

export function PanelsSkeleton({ panels = 1, rows = 3 }: { panels?: number; rows?: number }) {
  return (
    <div className="flex flex-col gap-5 md:gap-6" role="status" aria-label="Loading">
      {Array.from({ length: panels }, (_, p) => (
        <div key={p} className="card px-5 py-5 md:px-6 md:py-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <div className="mt-6 flex flex-col gap-5">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i}>
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="mt-2 h-10 w-full max-w-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Integer-string schema helper message for day/minute inputs. */
export function wholeNumberInRange(value: string, min: number, max: number): boolean {
  if (!/^\d{1,6}$/.test(value)) return false
  const n = Number(value)
  return n >= min && n <= max
}

/** Read-only value row (for example, a username that cannot change). */
export function ReadOnlyRow({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      <div className="flex h-11 items-center gap-2 rounded-md border border-dashed border-line-strong/60 bg-sunken/60 px-3 text-base text-muted md:h-10">
        {icon}
        <span className="min-w-0 truncate">{value}</span>
      </div>
      {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

/** A quiet expandable group, used for archived items below a list. */
export function Disclosure({ label, count, children, className }: { label: string; count?: number; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={cn('border-t border-line pt-3', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="-mx-2 inline-flex h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted hover:bg-sunken hover:text-ink md:h-9"
      >
        <ChevronDown size={16} aria-hidden className={cn('transition-transform duration-[var(--dur-2)]', !open && '-rotate-90')} />
        {label}
        {count !== undefined ? <span className="num rounded-full bg-sunken px-1.5 text-xs text-subtle">{count}</span> : null}
      </button>
      <div id={id} hidden={!open} className="pt-2">
        {open ? children : null}
      </div>
    </div>
  )
}

/** List skeleton for reference-data sections. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card px-5 py-5 md:px-6 md:py-6" role="status" aria-label="Loading">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 flex flex-col divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="size-9 rounded-md" />
            <div className="flex-1">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-1.5 h-3 w-28" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}
