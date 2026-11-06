import { zodResolver } from '@hookform/resolvers/zod'
import { Check, KeyRound, PlugZap, ShieldCheck, Trash2, Unplug } from 'lucide-react'
import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'
import { api } from '@/api'
import type { AIProvider, AIRead, AISettingsInput } from '@/api/types'
import { DateText } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { ChoiceCards, TextField } from '@/components/ui/Field'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { aiProviderOption, aiProviders, isAIProvider } from '@/lib/ai-providers'
import { cn } from '@/lib/cn'
import { formatMonthLong } from '@/lib/dates'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useAI, useApiMutation } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { endpointHost, ERROR_CODE_LABELS, formatTokens, providerLabel, REQUEST_TYPE_LABELS, USAGE_STATUS } from '@/features/ai/ai-meta'
import { PanelsSkeleton, ProblemNotice, ReadOnlyRow, SaveStatus, SettingsPanel, SettingsStack } from './settings-kit'

// ---- validation (mirrors AISettingsInput; the server stays authoritative) ------------------------

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const MIN_MONTHLY = 10_000
const MAX_MONTHLY = 100_000_000
const MIN_OUTPUT = 256

/** "100,000" → 100000; null when it isn't a whole number. */
function wholeNumber(input: string): number | null {
  const v = input.replace(/[,\s_]/g, '')
  if (!/^\d{1,12}$/.test(v)) return null
  return Number(v)
}

const settingsSchema = z
  .object({
    provider: z.enum(['openai', 'anthropic', 'deepseek']),
    model: z
      .string()
      .trim()
      .min(1, 'Enter the model ID, for example gpt-5.5 or claude-sonnet-5')
      .max(200, 'Use 200 characters or fewer')
      .regex(MODEL_PATTERN, 'Use the provider’s model ID: letters, numbers, dots, dashes, underscores, or colons, starting with a letter or number'),
    monthlyTokenLimit: z.string().refine((v) => {
      const n = wholeNumber(v)
      return n !== null && n >= MIN_MONTHLY && n <= MAX_MONTHLY
    }, 'Use a whole number from 10,000 to 100,000,000'),
    maxOutputTokens: z.string().refine((v) => {
      const n = wholeNumber(v)
      return n !== null && n >= MIN_OUTPUT
    }, 'Use a whole number of at least 256'),
  })
  .superRefine((v, ctx) => {
    const limit = wholeNumber(v.monthlyTokenLimit)
    const output = wholeNumber(v.maxOutputTokens)
    if (limit !== null && output !== null && output >= MIN_OUTPUT && output > limit) {
      ctx.addIssue({ code: 'custom', path: ['maxOutputTokens'], message: `Keep this at or below the monthly limit (${formatTokens(limit)})` })
    }
  })
type SettingsValues = z.infer<typeof settingsSchema>

function defaults(ai: AIRead): SettingsValues {
  const s = ai.settings
  const provider: AIProvider = s && isAIProvider(s.provider) ? s.provider : 'openai'
  return {
    provider,
    model: s?.model ?? aiProviderOption(provider).suggestedModels[0] ?? '',
    monthlyTokenLimit: String(s?.monthlyTokenLimit ?? 100_000),
    maxOutputTokens: String(s?.maxOutputTokens ?? 1_200),
  }
}

function toInput(v: SettingsValues): AISettingsInput {
  return {
    provider: v.provider,
    model: v.model.trim(),
    monthlyTokenLimit: wholeNumber(v.monthlyTokenLimit) ?? 0,
    maxOutputTokens: wholeNumber(v.maxOutputTokens) ?? 0,
  }
}

// ---- provider and model ---------------------------------------------------------------------------

function ProviderForm({ ai }: { ai: AIRead }) {
  const connected = !!ai.settings
  const online = useOnline()
  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), mode: 'onTouched', defaultValues: defaults(ai) })
  const { register, control, handleSubmit, formState, setValue, reset, getValues } = form
  const provider = useWatch({ control, name: 'provider' })
  const model = useWatch({ control, name: 'model' })
  const option = aiProviderOption(provider)
  const listId = useId()
  const save = useApiMutation<AISettingsInput, unknown>({
    mutationFn: (body) => api.ai.saveSettings(body),
    success: connected ? 'AI provider settings saved' : 'AI provider connected',
    toastError: false,
    onSuccess: () => reset(getValues()),
  })

  const changeProvider = (next: AIProvider) => {
    const current = getValues('model').trim()
    // Keep a custom model ID; swap a suggestion (or nothing) for the new provider's first suggestion.
    if (!current || option.suggestedModels.includes(current)) setValue('model', aiProviderOption(next).suggestedModels[0] ?? '', { shouldDirty: true, shouldValidate: true })
    setValue('provider', next, { shouldDirty: true })
  }

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    save.mutate(toInput(v))
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel
        title="AI provider"
        description="Use your own OpenAI, Anthropic, or DeepSeek account to convert statements into import files. Nothing is sent until you ask for a conversion."
        action={
          connected ? (
            <Badge tone="positive" icon={<Check size={12} aria-hidden />}>
              Connected
            </Badge>
          ) : (
            <Badge tone="neutral">Not connected</Badge>
          )
        }
        footer={
          <>
            <SaveStatus dirty={connected && formState.isDirty} />
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!online || (connected && !formState.isDirty)} title={!online ? OFFLINE_REASON : undefined}>
              {connected ? 'Save changes' : 'Connect provider'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <ProblemNotice error={save.error} />
          <ChoiceCards<AIProvider>
            name="provider"
            legend="Provider"
            value={provider}
            onChange={changeProvider}
            columns={3}
            options={aiProviders.map((p) => ({ value: p.value, title: p.label, description: endpointHost(p.endpoint) }))}
          />
          <div className="grid gap-5 md:grid-cols-2">
            <div className="min-w-0">
              <TextField
                label="Model"
                list={listId}
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                error={formState.errors.model?.message}
                hint={`Pick a suggestion or enter any model ID ${option.label} serves.`}
                {...register('model')}
              />
              <datalist id={listId}>
                {option.suggestedModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={`Suggested ${option.label} models`}>
                {option.suggestedModels.map((m) => {
                  const active = model.trim() === m
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setValue('model', m, { shouldDirty: true, shouldValidate: true })}
                      className={cn(
                        'inline-flex h-9 items-center rounded-full border px-3 font-mono text-xs transition-colors duration-[var(--dur-1)] md:h-8',
                        active ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
                      )}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>
            <ReadOnlyRow label="API endpoint" value={<span className="font-mono text-sm">{option.endpoint}</span>} hint="Fixed for each provider. Custom endpoints aren’t supported." />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="Monthly token limit"
              inputMode="numeric"
              autoComplete="off"
              error={formState.errors.monthlyTokenLimit?.message}
              hint="Shared by reviews and conversions. 10,000 to 100,000,000."
              {...register('monthlyTokenLimit', { deps: ['maxOutputTokens'] })}
            />
            <TextField
              label="Maximum output tokens"
              inputMode="numeric"
              autoComplete="off"
              error={formState.errors.maxOutputTokens?.message}
              hint="Caps each response. At least 256 and no more than the monthly limit."
              {...register('maxOutputTokens')}
            />
          </div>
        </div>
      </SettingsPanel>
    </form>
  )
}

// ---- stored credential -------------------------------------------------------------------------------

const keySchema = z.object({
  apiKey: z.string().trim().min(8, 'Paste the full key from your provider (at least 8 characters)').max(4096, 'That’s longer than any provider key. Check what you pasted.'),
})
type KeyValues = z.infer<typeof keySchema>

function CredentialPanel({ ai }: { ai: AIRead }) {
  const s = ai.settings
  const online = useOnline()
  const [replacing, setReplacing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const form = useForm<KeyValues>({ resolver: zodResolver(keySchema), defaultValues: { apiKey: '' } })
  const { register, handleSubmit, formState, reset } = form
  const store = useApiMutation<string, unknown>({
    mutationFn: (key) => api.ai.saveCredential(key),
    success: s?.hasStoredApiKey ? 'API key replaced' : 'API key stored',
    toastError: false,
    onSuccess: () => setReplacing(false),
  })
  const remove = useApiMutation<void, void>({
    mutationFn: () => api.ai.removeCredential(),
    success: 'Stored API key removed',
    onSuccess: () => setConfirmRemove(false),
  })

  const onSubmit = handleSubmit((v) => {
    if (store.isPending) return
    // The key leaves the form as soon as it is sent; it is never kept in client state.
    store.mutate(v.apiKey.trim())
    reset({ apiKey: '' })
  })

  const showForm = !!s && (!s.hasStoredApiKey || replacing)
  const cancelReplace = () => {
    setReplacing(false)
    reset({ apiKey: '' })
    store.reset()
  }

  return (
    <SettingsPanel
      title="API key"
      description="Store your provider key so you don’t paste it every time. It’s encrypted on the server and never shown again; only its last four characters are."
      footer={
        showForm ? (
          <>
            {!online ? <p className="mr-auto text-xs text-warning">{OFFLINE_REASON}</p> : <span className="mr-auto" />}
            {replacing ? (
              <Button variant="ghost" onClick={cancelReplace}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" form="ai-key-form" variant="primary" loading={store.isPending} disabled={!online}>
              {s?.hasStoredApiKey ? 'Replace key' : 'Store encrypted key'}
            </Button>
          </>
        ) : undefined
      }
    >
      {!s ? (
        <p className="text-sm text-muted">Connect a provider first. You can then store a key here, or paste a session-only key each time you request a review or conversion.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {s.hasStoredApiKey ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sunken/40 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <KeyRound size={17} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    Encrypted {providerLabel(s.provider)} key
                    {s.apiKeyHint ? (
                      <>
                        {' '}
                        ending <span className="font-mono">{s.apiKeyHint.replace(/^\.+/, '')}</span>
                      </>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">Used for reviews and conversions unless you enter a session-only key.</p>
                </div>
              </div>
              {!replacing ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setReplacing(true)} disabled={!online}>
                    Replace
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={15} aria-hidden />} onClick={() => setConfirmRemove(true)} disabled={!online} title={!online ? OFFLINE_REASON : undefined}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {showForm ? (
            <form id="ai-key-form" onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
              <ProblemNotice error={store.error} />
              <TextField
                label={s.hasStoredApiKey ? 'New API key' : 'API key'}
                type="password"
                autoComplete="off"
                spellCheck={false}
                error={formState.errors.apiKey?.message}
                hint={`Create one in your ${providerLabel(s.provider)} account. A stored key replaces the previous one.`}
                {...register('apiKey')}
              />
            </form>
          ) : null}
          {!s.hasStoredApiKey ? (
            <p className="flex items-start gap-2 text-xs text-muted">
              <ShieldCheck size={15} aria-hidden className="mt-px shrink-0 text-subtle" />
              Prefer not to store it? Paste a session-only key on the review or import page instead. It’s used for that one request and never saved.
            </p>
          ) : null}
        </div>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the stored API key?"
        description="Reviews and conversions will ask for a session-only key until you store a new one. Your provider settings and usage history stay."
        confirmLabel="Remove key"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </SettingsPanel>
  )
}

// ---- usage -------------------------------------------------------------------------------------------

const EVENTS_PAGE = 20

function UsageStatus({ status }: { status: string }) {
  const meta = USAGE_STATUS[status] ?? { label: status.replace(/_/g, ' '), tone: 'neutral' as const }
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

const latency = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`)

function UsagePanel({ ai }: { ai: AIRead }) {
  const { usage, events } = ai
  const online = useOnline()
  const [showAll, setShowAll] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const clear = useApiMutation<void, { deleted: number }>({
    mutationFn: () => api.ai.clearUsage(),
    success: (r) => (r.deleted === 1 ? 'Cleared 1 usage record' : `Cleared ${formatTokens(r.deleted)} usage records`),
    onSuccess: () => setConfirmClear(false),
  })
  const limit = usage.monthlyTokenLimit
  // Token counts are not money, so a plain ratio is fine for the bar.
  const usedPercent = limit > 0 ? ((Math.min(usage.chargedTokens, limit) / limit) * 100).toFixed(1) : '0'
  const shown = showAll ? events : events.slice(0, EVENTS_PAGE)
  const month = /^\d{4}-\d{2}$/.test(usage.billingMonth) ? formatMonthLong(`${usage.billingMonth}-15T12:00:00Z`, 'UTC') : 'This month'
  const requestLabel = (type: string) => REQUEST_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')

  return (
    <SettingsPanel
      title="Usage"
      description="Reviews and conversions share one monthly token budget. Usage records hold only metadata, never your data, prompts, or responses."
      action={
        <Button size="sm" icon={<Trash2 size={15} aria-hidden />} onClick={() => setConfirmClear(true)} disabled={!online || events.length === 0} title={!online ? OFFLINE_REASON : undefined}>
          Clear usage history
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-medium text-ink">{month}</h3>
            <p className="text-sm text-muted">
              <span className="num font-medium text-ink">{formatTokens(usage.chargedTokens)}</span> of <span className="num">{limit > 0 ? formatTokens(limit) : '—'}</span> tokens charged
            </p>
          </div>
          <ProgressBar className="mt-2" percent={usedPercent} tone={usage.remainingTokens === 0 && limit > 0 ? 'warning' : 'accent'} label="Monthly tokens charged" />
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Remaining</dt>
              <dd className="num mt-0.5 text-md font-semibold text-ink">{formatTokens(usage.remainingTokens)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Successful requests</dt>
              <dd className="num mt-0.5 text-md font-semibold text-ink">{formatTokens(usage.successfulRequests)}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs text-muted">Last used</dt>
              <dd className="mt-0.5 text-md font-semibold text-ink">{usage.lastUsedAt ? <DateText value={usage.lastUsedAt} withTime /> : <span className="text-muted">Not yet</span>}</dd>
            </div>
          </dl>
        </div>

        {events.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong/60 px-4 py-6 text-center text-sm text-muted">
            No AI requests yet. Each review or conversion adds a record here with its token count and outcome.
          </p>
        ) : (
          <div>
            <h3 className="mb-2 text-sm font-medium text-ink">Requests</h3>
            <div className="scroll-x hidden rounded-md border border-line md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">AI requests, newest first</caption>
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      When
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Request
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Model
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Outcome
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Charged
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      In / out
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id} className="border-t border-line align-top first:border-t-0">
                      <td className="px-3 py-2 text-muted">
                        <DateText value={e.createdAt} withTime />
                      </td>
                      <td className="px-3 py-2 text-ink">{requestLabel(e.requestType)}</td>
                      <td className="max-w-48 px-3 py-2">
                        <span className="block truncate font-mono text-xs text-muted" title={`${e.model} · ${e.endpointHost}`}>
                          {e.model}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <UsageStatus status={e.status} />
                        {e.errorCode ? <p className="mt-1 text-xs text-muted">{ERROR_CODE_LABELS[e.errorCode] ?? e.errorCode}</p> : null}
                      </td>
                      <td className="num px-3 py-2 text-right text-ink">{formatTokens(e.chargedTokens)}</td>
                      <td className="num px-3 py-2 text-right text-muted">
                        {formatTokens(e.inputTokens)} / {formatTokens(e.outputTokens)}
                      </td>
                      <td className="num px-3 py-2 text-right text-muted">{latency(e.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line rounded-md border border-line md:hidden" aria-label="AI requests, newest first">
              {shown.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{requestLabel(e.requestType)}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      <DateText value={e.createdAt} withTime /> · <span className="font-mono">{e.model}</span>
                    </p>
                    {e.errorCode ? <p className="mt-0.5 text-xs text-muted">{ERROR_CODE_LABELS[e.errorCode] ?? e.errorCode}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <UsageStatus status={e.status} />
                    <span className="num text-xs text-muted">{formatTokens(e.chargedTokens)} tokens</span>
                  </div>
                </li>
              ))}
            </ul>
            {events.length > EVENTS_PAGE ? (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show all ${formatTokens(events.length)} requests`}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear usage history?"
        description={`Deletes ${events.length === 1 ? 'the 1 usage record' : `all ${formatTokens(events.length)} usage records`}. This month’s token count is worked out from these records, so it starts again from zero.`}
        confirmLabel="Clear history"
        pending={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </SettingsPanel>
  )
}

// ---- disconnect ----------------------------------------------------------------------------------------

function DisconnectPanel({ ai }: { ai: AIRead }) {
  const online = useOnline()
  const [open, setOpen] = useState(false)
  const disconnect = useApiMutation<void, void>({
    mutationFn: () => api.ai.disconnect(),
    success: 'AI provider disconnected',
    onSuccess: () => setOpen(false),
  })
  if (!ai.settings) return null
  return (
    <SettingsPanel
      title="Disconnect provider"
      description="Removes the provider, model, limits, and any stored key. Usage history stays until you clear it. Reviews and AI conversion stop until you connect again."
      action={
        <Button variant="danger" icon={<Unplug size={16} aria-hidden />} onClick={() => setOpen(true)} disabled={!online} title={!online ? OFFLINE_REASON : undefined}>
          Disconnect
        </Button>
      }
    >
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Disconnect ${providerLabel(ai.settings.provider)}?`}
        description="Your provider settings and any stored key are deleted. Usage history stays until you clear it."
        confirmLabel="Disconnect"
        pending={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </SettingsPanel>
  )
}

// ---- page -----------------------------------------------------------------------------------------------

export default function AiSettings() {
  usePageTitle('AI provider')
  const ai = useAI()
  if (ai.isPending) return <PanelsSkeleton panels={3} rows={3} />
  if (ai.isError)
    return (
      <div className="card">
        <ErrorState error={ai.error} onRetry={() => void ai.refetch()} title="AI settings could not be loaded" />
      </div>
    )
  const data = ai.data
  // Re-key after a save so the form re-initialises from the server's values.
  const formKey = data.settings ? `${data.settings.provider}:${data.settings.updatedAt}` : 'new'
  return (
    <SettingsStack>
      <ProviderForm key={formKey} ai={data} />
      <CredentialPanel ai={data} />
      <UsagePanel ai={data} />
      <DisconnectPanel ai={data} />
      {data.settings ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-muted">
          <PlugZap size={15} aria-hidden className="text-subtle" />
          Ready when you are.
          <Link to="/accounts?import=1" className="link">
            Convert a statement
          </Link>
        </p>
      ) : null}
    </SettingsStack>
  )
}
