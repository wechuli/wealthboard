import { useQueryClient } from '@tanstack/react-query'
import { Clock, Eye, EyeOff, FileSearch, Lock, ShieldCheck, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { AIRead, AIReviewFocus, AIReviewPeriod, AIReviewRequest, AIReviewResult } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ChoiceCards, SwitchField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { ProblemNotice } from '@/features/settings/settings-kit'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { usePrivacy } from '@/lib/privacy'
import { useApiMutation, useUserKey } from '@/lib/queries'
import { endpointHost, FOCUS_OPTIONS, formatTokens, PERIOD_OPTIONS, providerLabel } from './ai-meta'
import { AvailabilityNotice } from './parts'
import { ReviewDocument } from './ReviewDocument'
import { buildReviewSnapshot, SNAPSHOT_MAX_BYTES, snapshotBytes, type ReviewSharing } from './snapshot'
import { SnapshotPreview } from './SnapshotPreview'

type Settings = NonNullable<AIRead['settings']>

interface GenerateVars {
  period: AIReviewPeriod
  focus: AIReviewFocus
  sharing: ReviewSharing
  apiKey: string
}

/** Fresh reads → snapshot → review. The snapshot is rebuilt at send time so it matches what the server sees now. */
async function generateReview({ period, focus, sharing, apiKey }: GenerateVars): Promise<AIReviewResult> {
  const [dashboard, allocation, goals, accounts] = await Promise.all([api.dashboard.get(period), api.reports.allocation(), api.goals.list(), api.accounts.list('active')])
  const snapshot = buildReviewSnapshot({ period, focus, sharing }, { dashboard, allocation, goals, accounts })
  if (snapshotBytes(snapshot) > SNAPSHOT_MAX_BYTES) {
    throw new ApiProblem({ type: 'about:blank', title: 'Snapshot too large', status: 0, detail: 'Your portfolio snapshot is over the 25,000-byte limit. Turn off account names or exact amounts and try again.' })
  }
  const body: AIReviewRequest = { period, focus, includeExactAmounts: sharing.includeExactAmounts, includeAccountNames: sharing.includeAccountNames, snapshot }
  const key = apiKey.trim()
  if (key) body.apiKey = key
  return api.ai.review(body)
}

function SharedList({ sharing }: { sharing: ReviewSharing }) {
  const items = [
    'Shares of your portfolio by category and currency',
    sharing.includeAccountNames ? 'Your ten largest accounts and every goal, by name' : 'Your ten largest accounts and every goal, as “Account 1”, “Goal 1”…',
    sharing.includeExactAmounts ? 'Exact totals, account values, and goal amounts' : 'Account and goal counts, without amounts',
    'Goal status and progress',
    'Missing exchange-rate warnings',
  ]
  return (
    <ul className="space-y-2.5 text-sm">
      {items.map((t) => (
        <li key={t} className="flex gap-2.5 text-ink">
          <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0 text-positive" />
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  )
}

function Waiting({ provider }: { provider: string }) {
  return (
    <div className="card overflow-hidden" role="status" aria-label={`Waiting for ${provider}`}>
      <div className="border-b border-line px-5 pb-7 pt-7 md:px-10 md:pt-10">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Clock size={15} aria-hidden />
          {provider} is reading your snapshot. This usually takes under a minute and can take up to two.
        </p>
        <Skeleton className="mt-5 h-8 w-3/4" />
        <Skeleton className="mt-6 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-11/12" />
        <Skeleton className="mt-2 h-4 w-2/3" />
      </div>
      <div className="space-y-3 px-5 py-7 md:px-10">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </div>
  )
}

export function ReviewWorkspace({ ai, settings }: { ai: AIRead; settings: Settings }) {
  const { defaultRange } = usePrefs()
  const { hidden, setHidden } = usePrivacy()
  const online = useOnline()
  const qc = useQueryClient()
  const userKey = useUserKey()
  const [period, setPeriod] = useState<AIReviewPeriod>(defaultRange)
  const [focus, setFocus] = useState<AIReviewFocus>('overall')
  const [sharing, setSharing] = useState<ReviewSharing>({ includeExactAmounts: settings.includeExactAmounts, includeAccountNames: settings.includeAccountNames })
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<AIReviewResult | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [preview, setPreview] = useState(false)
  const attempt = useRef(0)
  const av = ai.reviewAvailability
  const provider = providerLabel(settings.provider)
  const needsKey = !settings.hasStoredApiKey
  const keyOk = apiKey.trim().length >= 8 && apiKey.trim().length <= 4096
  const refreshAI = () => void qc.invalidateQueries({ queryKey: ['u', userKey, 'ai'] })

  const review = useApiMutation<GenerateVars, AIReviewResult>({ mutationFn: generateReview, toastError: false })

  // When a cooldown ends, re-read availability so the button comes back on its own.
  const cooldownUntil = av.reason === 'cooldown' ? av.cooldownUntil : null
  useEffect(() => {
    if (!cooldownUntil) return
    const wait = Math.max(0, new Date(cooldownUntil).getTime() - Date.now()) + 500
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: ['u', userKey, 'ai'] }), Math.min(wait, 120_000))
    return () => clearTimeout(t)
  }, [cooldownUntil, qc, userKey])

  const busy = review.isPending && !cancelled
  const disabledReason = !online
    ? OFFLINE_REASON
    : !av.available
      ? 'Reviews aren’t available right now.'
      : needsKey && !keyOk
        ? 'Enter a session-only API key first.'
        : !needsKey && apiKey.trim() && !keyOk
          ? 'The session-only key looks too short.'
          : undefined

  const start = () => {
    if (busy || disabledReason) return
    const id = ++attempt.current
    setCancelled(false)
    review.mutate(
      { period, focus, sharing, apiKey },
      {
        onSuccess: (r) => {
          if (id !== attempt.current) return
          setResult(r)
          setApiKey('')
        },
        onSettled: () => refreshAI(),
      },
    )
  }

  const cancel = () => {
    attempt.current++
    setCancelled(true)
  }

  const showError = review.isError && !cancelled

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="review-request" className="card min-w-0">
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 md:px-6 md:pt-6">
            <div className="min-w-0">
              <h2 id="review-request" className="text-md font-semibold text-ink">
                Request a review
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {provider} · <span className="font-mono text-[0.8125rem]">{settings.model}</span> · {endpointHost(settings.baseUrl)}
              </p>
            </div>
          </header>
          <div className="flex flex-col gap-6 px-5 pb-5 pt-5 md:px-6">
            <AvailabilityNotice availability={ai.reviewAvailability} />
            <div>
              <p className="mb-2 text-sm font-medium text-ink" aria-hidden>
                Period
              </p>
              <Segmented<AIReviewPeriod> label="Period" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
            </div>
            <ChoiceCards<AIReviewFocus> name="review-focus" legend="Focus" value={focus} onChange={setFocus} columns={2} options={FOCUS_OPTIONS} />
            <fieldset className="rounded-lg border border-line px-4 py-3">
              <legend className="px-1 text-sm font-medium text-ink">What to share for this review</legend>
              <div className="flex flex-col divide-y divide-line">
                <div className="py-2">
                  <SwitchField
                    label="Include exact amounts"
                    description="Totals, account values, and goal amounts. When off, only shares, counts, and progress are sent."
                    checked={sharing.includeExactAmounts}
                    onCheckedChange={(v) => setSharing((s) => ({ ...s, includeExactAmounts: v }))}
                  />
                </div>
                <div className="py-2">
                  <SwitchField
                    label="Include account and goal names"
                    description="When off, they’re sent as “Account 1”, “Goal 1”, and so on."
                    checked={sharing.includeAccountNames}
                    onCheckedChange={(v) => setSharing((s) => ({ ...s, includeAccountNames: v }))}
                  />
                </div>
              </div>
            </fieldset>
            <TextField
              label="Session-only API key"
              optional={!needsKey}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={needsKey ? `Your ${provider} key` : `Using your stored key${settings.apiKeyHint ? ` ending ${settings.apiKeyHint.replace(/^\.+/, '')}` : ''}`}
              hint={
                needsKey ? (
                  <>
                    No key is stored, so paste one for this review. It’s used once, never saved, and cleared when the review arrives.{' '}
                    <Link to="/settings/ai" className="link">
                      Store a key instead
                    </Link>
                  </>
                ) : (
                  'Leave empty to use your stored key. A key entered here is used once and never saved.'
                )
              }
            />
          </div>
          <div className="flex flex-col gap-3 border-t border-line px-5 py-4 md:px-6">
            {showError ? <ProblemNotice error={review.error} /> : null}
            {cancelled ? (
              <Notice tone="info" role="status" title="Review cancelled">
                Its result won’t be shown. If {provider} had already started, it may still charge for the request.
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 basis-64 text-xs text-muted">
                Sends one snapshot to {provider}, with up to <span className="num">{formatTokens(settings.maxOutputTokens)}</span> output tokens. Your provider may charge for this.
              </p>
              <div className="flex flex-wrap gap-2">
                {busy ? (
                  <Button variant="ghost" icon={<X size={16} aria-hidden />} onClick={cancel}>
                    Cancel
                  </Button>
                ) : null}
                <Button variant="primary" icon={<Sparkles size={16} aria-hidden />} loading={busy} onClick={start} disabled={!!disabledReason} title={disabledReason}>
                  Generate review
                </Button>
              </div>
            </div>
          </div>
        </section>

        <aside aria-labelledby="review-shared" className="card min-w-0 self-start">
          <div className="px-5 pt-5 md:px-6 md:pt-6">
            <h2 id="review-shared" className="text-md font-semibold text-ink">
              What’s shared
            </h2>
            <p className="mt-0.5 text-sm text-muted">Built by Wealthboard from figures it already calculates.</p>
          </div>
          <div className="space-y-5 px-5 pb-5 pt-4 md:px-6">
            <SharedList sharing={sharing} />
            <p className="flex gap-2.5 rounded-md bg-sunken px-3 py-2.5 text-xs text-muted">
              <Lock size={14} aria-hidden className="mt-px shrink-0" />
              Never shared: notes, account references, transaction rows or descriptions, instruments and trades, or your profile.
            </p>
            <Button size="sm" icon={<FileSearch size={15} aria-hidden />} onClick={() => setPreview(true)}>
              See exactly what’s sent
            </Button>
            <div className="border-t border-line pt-4">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted">Tokens left this month</span>
                <span className="num font-medium text-ink">{formatTokens(ai.usage.remainingTokens)}</span>
              </div>
              <ProgressBar
                className="mt-2"
                label="Monthly tokens remaining"
                tone={ai.usage.remainingTokens === 0 ? 'warning' : 'accent'}
                percent={ai.usage.monthlyTokenLimit > 0 ? ((ai.usage.remainingTokens / ai.usage.monthlyTokenLimit) * 100).toFixed(1) : '0'}
              />
              <p className="mt-1.5 text-xs text-muted">
                of <span className="num">{formatTokens(ai.usage.monthlyTokenLimit)}</span>, shared with statement conversion.{' '}
                <Link to="/settings/ai" className="link">
                  Usage
                </Link>
              </p>
            </div>
          </div>
        </aside>
      </div>

      {busy ? (
        <Waiting provider={provider} />
      ) : !result ? (
        <div className="card">
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
              <Sparkles size={22} aria-hidden />
            </div>
            <h2 className="text-md font-semibold text-ink">No review yet in this visit</h2>
            <p className="mt-1.5 max-w-[48ch] text-sm text-muted">Choose a period and focus, then generate a review. Reviews aren’t saved: each one disappears when you leave or reload this page.</p>
          </div>
        </div>
      ) : hidden ? (
        <div className="card">
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-full bg-sunken text-muted">
              <EyeOff size={22} aria-hidden />
            </div>
            <h2 className="text-md font-semibold text-ink">Review hidden</h2>
            <p className="mt-1.5 max-w-[48ch] text-sm text-muted">Values are hidden, and a review can repeat figures from your portfolio, so it stays out of view until you show values.</p>
            <Button className="mt-5" icon={<Eye size={16} aria-hidden />} onClick={() => setHidden(false)}>
              Show values
            </Button>
          </div>
        </div>
      ) : (
        <div aria-live="polite">
          <ReviewDocument result={result} />
        </div>
      )}

      <SnapshotPreview open={preview} onOpenChange={setPreview} period={period} focus={focus} sharing={sharing} />
    </div>
  )
}
