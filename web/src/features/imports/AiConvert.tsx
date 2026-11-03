import { useQueryClient } from '@tanstack/react-query'
import { Eye, FileText, FileUp, Lock, ScanText, Send, ShieldCheck, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '@/api'
import type { Account, AIConversionDraft, AIConversionRequest, AIRead, AISource } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConvertDraft } from '@/features/review/ConvertDraft'
import { configurationHash, endpointHost, formatTokens, providerLabel } from '@/features/review/ai-meta'
import { ManualPrompt } from '@/features/review/ManualPrompt'
import { AdviceNotice, AvailabilityNotice } from '@/features/review/parts'
import { SourceUnits } from '@/features/review/SourceUnits'
import { ProblemNotice } from '@/features/settings/settings-kit'
import { cn } from '@/lib/cn'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrivacy } from '@/lib/privacy'
import { useAI, useApiMutation, useUserKey } from '@/lib/queries'
import { extractSource, MAX_PASSWORD_LENGTH, MAX_SOURCE_BYTES } from '@/lib/source-extraction'
import { encodedSize } from '@/lib/source-extraction/source'

const ACCEPT = '.csv,.tsv,.json,.txt,.xlsx,.pdf,.docx'
type Settings = NonNullable<AIRead['settings']>

const formatBytes = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function Step({ n, title, done, children, id }: { n: number; title: string; done?: boolean; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="relative border-t border-line py-6 first:border-t-0 first:pt-2">
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden className={cn('num grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold', done ? 'bg-accent text-on-accent' : 'bg-sunken text-muted ring-1 ring-line')}>
          {n}
        </span>
        <h3 id={id} className="text-md font-semibold text-ink">
          {title}
        </h3>
      </div>
      <div className="min-w-0 md:pl-10">{children}</div>
    </section>
  )
}

interface ConvertVars {
  settings: Settings
  source: AISource
  apiKey: string
}

/** Converting a statement into a Wealthboard import draft with the person's own AI provider, with explicit consent each time. */
export function AiConvert({ account }: { account: Account }) {
  const ai = useAI()
  const online = useOnline()
  const { hidden, setHidden } = usePrivacy()
  const [, setParams] = useSearchParams()
  const qc = useQueryClient()
  const userKey = useUserKey()
  const trackingMode: 'balance' | 'positions' = account.trackingMode === 'positions' ? 'positions' : 'balance'
  const ids = { file: useId(), consent: useId(), s1: useId(), s2: useId(), s3: useId(), s4: useId() }

  const fileInput = useRef<HTMLInputElement>(null)
  const extraction = useRef<AbortController | null>(null)
  const attempt = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [source, setSource] = useState<AISource | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [consent, setConsent] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [draft, setDraft] = useState<AIConversionDraft | null>(null)
  const [sentUnits, setSentUnits] = useState(0)
  const [cancelled, setCancelled] = useState(false)

  const convert = useApiMutation<ConvertVars, AIConversionDraft>({
    mutationFn: async ({ settings, source: approved, apiKey: key }) => {
      const body: AIConversionRequest = {
        source: approved,
        configurationHash: await configurationHash(settings, trackingMode, account.currency),
        consent: true,
        trackingMode,
        currency: account.currency,
      }
      if (key.trim()) body.apiKey = key.trim()
      return api.ai.convertImport(body)
    },
    toastError: false,
  })

  // Abort any running extraction when leaving; transient content lives only in this component.
  useEffect(() => () => extraction.current?.abort(), [])
  const passwordRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (passwordError && !extracting) passwordRef.current?.focus()
  }, [passwordError, extracting])

  const isPdf = !!file && file.name.toLowerCase().endsWith('.pdf')

  const resetApproval = () => {
    setConsent(false)
    convert.reset()
  }

  const clearAll = () => {
    extraction.current?.abort()
    extraction.current = null
    attempt.current++
    if (fileInput.current) fileInput.current.value = ''
    setFile(null)
    setPassword('')
    setPasswordError(false)
    setExtracting(false)
    setExtractError(null)
    setSource(null)
    setSourceName('')
    setSelected(new Set())
    setConsent(false)
    setApiKey('')
    setDraft(null)
    setCancelled(false)
    convert.reset()
  }

  const extract = async () => {
    if (!file || extracting) return
    if (file.size > MAX_SOURCE_BYTES) {
      setExtractError('Choose a file no larger than 5 MB.')
      return
    }
    const pw = isPdf ? password : ''
    setPassword('')
    setExtracting(true)
    setExtractError(null)
    const controller = new AbortController()
    extraction.current = controller
    try {
      const extracted = await extractSource(file, pw, { signal: controller.signal })
      if (controller.signal.aborted) return
      setSource(extracted)
      setSourceName(file.name)
      setSelected(new Set(extracted.units.map((u) => u.id)))
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setPasswordError(false)
      setDraft(null)
      resetApproval()
    } catch (caught) {
      if (controller.signal.aborted) return
      const code = caught instanceof Error && 'code' in caught ? (caught as { code?: string }).code : undefined
      setPasswordError(code === 'password_required' || code === 'incorrect_password')
      setExtractError(caught instanceof Error ? caught.message : 'The file couldn’t be read.')
    } finally {
      if (extraction.current === controller) {
        extraction.current = null
        setExtracting(false)
      }
    }
  }

  const cancelExtraction = () => {
    extraction.current?.abort()
    extraction.current = null
    setExtracting(false)
    setPassword('')
  }

  const settings = ai.data?.settings ?? null
  const approvedUnits = source ? source.units.filter((u) => selected.has(u.id)) : []
  const emptySelected = approvedUnits.filter((u) => !u.text.trim()).length
  const approvedSize = source ? encodedSize({ units: approvedUnits, warnings: source.warnings }) : 0
  const needsKey = !!settings && !settings.hasStoredApiKey
  const keyLength = apiKey.trim().length
  const keyOk = needsKey ? keyLength >= 8 && keyLength <= 4096 : keyLength === 0 || (keyLength >= 8 && keyLength <= 4096)
  const available = ai.data?.reviewAvailability.available ?? false
  const busy = convert.isPending && !cancelled
  const canSend = !!settings && !!source && consent && approvedUnits.length > 0 && emptySelected === 0 && keyOk && online && available && !busy

  const send = () => {
    if (!canSend || !settings || !source) return
    const id = ++attempt.current
    setCancelled(false)
    setDraft(null)
    const approved: AISource = { units: approvedUnits, warnings: source.warnings }
    convert.mutate(
      { settings, source: approved, apiKey },
      {
        onSuccess: (d) => {
          if (id !== attempt.current) return
          setDraft(d)
          setSentUnits(approved.units.length)
        },
        onSettled: () => {
          setApiKey('')
          setConsent(false)
          // Usage changes on failures too (the reservation can be kept), so re-read the budget.
          void qc.invalidateQueries({ queryKey: ['u', userKey, 'ai'] })
        },
      },
    )
  }

  const cancelConversion = () => {
    attempt.current++
    setCancelled(true)
  }

  const openDirectImport = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('tab')
        return next
      },
      { replace: true },
    )

  const aside = (
    <Card as="aside" aria-labelledby="ai-privacy" className="self-start">
      <CardHeader id="ai-privacy" title="Your data, your call" />
      <CardBody className="space-y-4 pt-2 text-sm">
        <div className="flex gap-3">
          <Lock size={18} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
          <p className="text-muted">The file is read in this browser and never uploaded. A PDF password is used only to open it here.</p>
        </div>
        <div className="flex gap-3">
          <Eye size={18} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
          <p className="text-muted">You choose and can redact every section before anything is sent. Only that text, its section labels, and the account’s currency and type go to your provider.</p>
        </div>
        <div className="flex gap-3">
          <ShieldCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
          <p className="text-muted">Nothing is imported automatically. The draft goes through the same preview, duplicate check, and confirmation as any file. Wealthboard keeps none of it; your provider’s own retention terms apply.</p>
        </div>
        <AdviceNotice compact />
      </CardBody>
    </Card>
  )

  if (hidden)
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-full bg-sunken text-muted">
              <Eye size={22} aria-hidden />
            </div>
            <h2 className="text-md font-semibold text-ink">Values are hidden</h2>
            <p className="mt-1.5 max-w-[46ch] text-sm text-muted">A statement shows your balances and transactions, so conversion stays paused while values are hidden.</p>
            <Button className="mt-5" icon={<Eye size={16} aria-hidden />} onClick={() => setHidden(false)}>
              Show values
            </Button>
          </div>
        </Card>
        {aside}
      </div>
    )

  let destination: ReactNode
  if (ai.isPending)
    destination = (
      <div role="status" aria-label="Loading AI settings" className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-10 w-48" />
      </div>
    )
  else if (ai.isError) destination = <ErrorState compact error={ai.error} onRetry={() => void ai.refetch()} title="AI settings couldn’t be loaded" />
  else if (!settings)
    destination = (
      <Notice
        tone="info"
        title="Connect an AI provider to convert statements"
        action={
          <Link to="/settings/ai" className={buttonClass({ size: 'sm' })}>
            Set up AI provider
          </Link>
        }
      >
        Use your own OpenAI, Anthropic, or DeepSeek key. Or use Direct import with a CSV or JSON file, or copy the prompt below into an AI tool you already use.
      </Notice>
    )
  else
    destination = (
      <div className="flex flex-col gap-4">
        <AvailabilityNotice availability={ai.data.reviewAvailability} what="AI requests" />
        <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line text-sm sm:grid-cols-2">
          {[
            ['Sent to', <>{providerLabel(settings.provider)} · <span className="font-mono text-xs">{settings.model}</span> · {endpointHost(settings.baseUrl)}</>],
            ['Account context', `${trackingMode === 'positions' ? 'Position-tracked' : 'Value-tracked'}, ${account.currency}`],
            ['Text', source ? `${approvedUnits.length} of ${source.units.length} sections · ${formatBytes(approvedSize)}` : 'Read a file first'],
            ['Response limit', `Up to ${formatTokens(settings.maxOutputTokens)} tokens · ${formatTokens(ai.data.usage.remainingTokens)} left this month`],
          ].map(([k, v]) => (
            <div key={String(k)} className="min-w-0 bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 break-words text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {needsKey || keyLength > 0 ? (
          <div className="max-w-md">
            <TextField
              label="Session-only API key"
              optional={!needsKey}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              disabled={busy}
              onChange={(e) => {
                setApiKey(e.target.value)
                setConsent(false)
              }}
              hint={needsKey ? 'No key is stored. This one is used for this conversion only and never saved.' : 'Used instead of your stored key, for this conversion only.'}
            />
          </div>
        ) : null}
        <div className="flex items-start gap-3 rounded-lg border border-line bg-sunken/40 p-4">
          <input
            id={ids.consent}
            type="checkbox"
            checked={consent}
            disabled={!source || busy}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
          />
          <label htmlFor={ids.consent} className="text-sm text-ink">
            I approve sending the selected text and account context to {providerLabel(settings.provider)}. Excluded or unreadable content won’t be converted, and {providerLabel(settings.provider)} may charge for this request.
          </label>
        </div>
        {busy ? null : convert.isError && !cancelled ? <ProblemNotice error={convert.error} /> : null}
        {cancelled ? (
          <Notice tone="info" role="status" title="Conversion cancelled">
            Its result won’t be shown. If {providerLabel(settings.provider)} had already started, it may still charge for the request.
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={<Send size={16} aria-hidden />}
            loading={busy}
            disabled={!canSend}
            onClick={send}
            title={!online ? OFFLINE_REASON : undefined}
          >
            {busy ? 'Converting…' : 'Convert selected text'}
          </Button>
          {busy ? (
            <Button variant="ghost" icon={<X size={16} aria-hidden />} onClick={cancelConversion}>
              Cancel
            </Button>
          ) : (
            <span className="text-xs text-muted">
              {!source
                ? 'Read a file first.'
                : approvedUnits.length === 0
                  ? 'Include at least one section.'
                  : emptySelected
                    ? 'A selected section is empty. Add text or exclude it.'
                    : !keyOk
                      ? 'Enter a valid API key.'
                      : !consent
                        ? 'Tick the approval to continue. It resets whenever you change what’s sent.'
                        : ''}
            </span>
          )}
        </div>
      </div>
    )

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card aria-labelledby="ai-heading">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-5 md:px-6 md:pt-6">
            <div className="min-w-0">
              <h2 id="ai-heading" className="display text-xl text-ink">
                Convert a statement with AI
              </h2>
              <p className="mt-2 max-w-[62ch] text-base text-muted">
                Read a PDF, spreadsheet, or document in this browser, choose exactly what to share, and let your AI provider draft importable rows for {account.name}. You check the draft before anything is imported.
              </p>
            </div>
            {settings ? <Badge tone="accent">{providerLabel(settings.provider)}</Badge> : ai.isSuccess ? <Badge tone="neutral">Not set up</Badge> : null}
          </div>
          <CardBody className="pt-4 md:pt-5">
            {!online ? (
              <Notice tone="warning" role="status" title="You’re offline" className="mb-4">
                Reading a file works offline, but conversion needs a connection.
              </Notice>
            ) : null}
            {account.archivedAt ? (
              <Notice tone="info" title="This account is archived" className="mb-4">
                You can still prepare a draft, but restore the account before importing it.
              </Notice>
            ) : null}

            <Step n={1} id={ids.s1} title="Choose a statement" done={!!source}>
              {source ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
                  <p className="flex min-w-0 items-center gap-2 text-sm text-ink">
                    <FileText size={17} aria-hidden className="shrink-0 text-subtle" />
                    <span className="min-w-0 truncate font-medium">{sourceName}</span>
                    <span className="shrink-0 text-muted">· {source.units.length === 1 ? '1 section' : `${source.units.length} sections`} read in this browser</span>
                  </p>
                  <Button size="sm" variant="ghost" onClick={clearAll} disabled={busy}>
                    Choose another file
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div>
                    <label htmlFor={ids.file} className="mb-1.5 block text-sm font-medium text-ink">
                      Source file
                    </label>
                    <input
                      ref={fileInput}
                      id={ids.file}
                      type="file"
                      accept={ACCEPT}
                      disabled={extracting}
                      aria-describedby={`${ids.file}-hint`}
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null)
                        setPassword('')
                        setPasswordError(false)
                        setExtractError(null)
                      }}
                      className="block w-full min-w-0 rounded-md border border-dashed border-line-strong/80 bg-sunken/40 p-3 text-sm text-muted file:mr-3 file:h-9 file:rounded-md file:border file:border-line-strong/70 file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink hover:border-line-strong"
                    />
                    <p id={`${ids.file}-hint`} className="mt-1.5 text-xs text-muted">
                      PDF, XLSX, DOCX, CSV, TSV, JSON, or TXT up to 5 MB. Scanned pages and images can’t be read.
                    </p>
                  </div>
                  {isPdf ? (
                    <div className="max-w-sm">
                      <TextField
                        ref={passwordRef}
                        label="PDF password (if required)"
                        optional
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={MAX_PASSWORD_LENGTH}
                        value={password}
                        disabled={extracting}
                        aria-invalid={passwordError || undefined}
                        onChange={(e) => setPassword(e.target.value)}
                        hint="Used only in this browser to open the file, then cleared. Never sent anywhere."
                      />
                    </div>
                  ) : null}
                  {extractError ? (
                    <Notice tone="negative" role="alert" title={passwordError ? 'Password needed' : 'The file couldn’t be read'}>
                      {extractError}
                    </Notice>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant={file ? 'primary' : 'secondary'} icon={<ScanText size={16} aria-hidden />} loading={extracting} disabled={!file || extracting} onClick={() => void extract()}>
                      {extracting ? 'Reading…' : 'Read file'}
                    </Button>
                    {extracting ? (
                      <Button variant="ghost" icon={<X size={16} aria-hidden />} onClick={cancelExtraction}>
                        Cancel
                      </Button>
                    ) : file ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                        <FileUp size={14} aria-hidden className="shrink-0" />
                        <span className="truncate">
                          {file.name} · {formatBytes(file.size)}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </Step>

            <Step n={2} id={ids.s2} title="Choose what to share" done={!!source && consent}>
              {source ? (
                <div className="flex flex-col gap-4">
                  {source.warnings.length ? (
                    <Notice tone="warning" title="Check these before sending">
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {source.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </Notice>
                  ) : null}
                  <p className="text-sm text-muted">Untick sections you don’t want to send, and edit text to remove anything private, such as account numbers. Only ticked text is sent.</p>
                  <SourceUnits
                    source={source}
                    selected={selected}
                    disabled={busy}
                    onSelect={(id, include) => {
                      setSelected((cur) => {
                        const next = new Set(cur)
                        if (include) next.add(id)
                        else next.delete(id)
                        return next
                      })
                      resetApproval()
                    }}
                    onSelectAll={(include) => {
                      setSelected(new Set(include ? source.units.map((u) => u.id) : []))
                      resetApproval()
                    }}
                    onEdit={(id, text) => {
                      setSource({ ...source, units: source.units.map((u) => (u.id === id ? { ...u, text } : u)) })
                      resetApproval()
                    }}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted">After the file is read, its text appears here in sections you can include, exclude, or edit.</p>
              )}
            </Step>

            <Step n={3} id={ids.s3} title="Send with your approval" done={!!draft}>
              {destination}
            </Step>

            <Step n={4} id={ids.s4} title="Check the draft">
              {busy ? (
                <div role="status" aria-label="Converting" className="space-y-2">
                  <p className="text-sm text-muted">Waiting for {settings ? providerLabel(settings.provider) : 'your provider'}. This can take up to two minutes.</p>
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-3/4" />
                </div>
              ) : draft ? (
                <ConvertDraft
                  draft={draft}
                  account={account}
                  sentUnits={sentUnits}
                  onEdit={(content) => setDraft({ ...draft, content })}
                  onDiscard={() => setDraft(null)}
                  onOpenDirectImport={openDirectImport}
                />
              ) : (
                <p className="text-sm text-muted">The draft appears here with each row, the sections it came from, and anything the model couldn’t convert. Nothing is imported from this page.</p>
              )}
            </Step>
          </CardBody>
        </Card>
        <ManualPrompt currency={account.currency} trackingMode={trackingMode} />
      </div>
      {aside}
    </div>
  )
}

