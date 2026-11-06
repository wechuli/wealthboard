import { TZDate } from '@date-fns/tz'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Copy, KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { api } from '@/api'
import type { APIKeyMetadata, APIKeyScope, CreateAPIKeyRequest, CreatedAPIKey } from '@/api/types'
import { DateText, RelativeDate } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { DateField, inputClass, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { usePrefs } from '@/lib/prefs'
import { useApiKeys, useApiMutation } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { applyFieldErrors, Disclosure, ListSkeleton, ProblemNotice, SettingsPanel, SettingsStack } from './settings-kit'

export const API_KEY_SCOPES: { scope: APIKeyScope; label: string; description: string }[] = [
  { scope: 'portfolio:read', label: 'Read portfolio data', description: 'Net worth, accounts, activity, goals, and reports.' },
  { scope: 'portfolio:write', label: 'Change portfolio data', description: 'Record transactions, valuations, trades, and goal changes.' },
  { scope: 'imports:write', label: 'Preview and commit imports', description: 'Upload account history files.' },
  { scope: 'exports:read', label: 'Download exports', description: 'Full-portfolio JSON and CSV exports.' },
]
const SCOPE_VALUES = API_KEY_SCOPES.map((s) => s.scope) as [APIKeyScope, ...APIKeyScope[]]

/** The end of the chosen day in the user's timezone, as a UTC instant. */
export function endOfDayInstant(date: string, timezone: string): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return new Date(new TZDate(y, m - 1, d, 23, 59, 59, 999, timezone).getTime()).toISOString()
}

function KeyPrefix({ prefix }: { prefix: string }) {
  return (
    <code className="num inline-block max-w-full truncate rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink">
      {prefix}
      <span className="text-subtle">…</span>
    </code>
  )
}

function Scopes({ scopes }: { scopes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <Badge key={s} tone={s === 'portfolio:read' ? 'neutral' : 'accent'} className="font-mono" title={API_KEY_SCOPES.find((x) => x.scope === s)?.label}>
          {s}
        </Badge>
      ))}
    </div>
  )
}

function Expiry({ k, now }: { k: APIKeyMetadata; now: number }) {
  if (!k.expiresAt) return <span className="text-subtle">Never</span>
  const expired = Date.parse(k.expiresAt) <= now
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <DateText value={k.expiresAt} />
      {expired ? <Badge tone="warning">Expired</Badge> : null}
    </span>
  )
}

function LastUsed({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-subtle">Never used</span>
  return <RelativeDate value={value} />
}

// ---- token, shown once -----------------------------------------------------------

function NewKeyDialog({ created, onClose }: { created: CreatedAPIKey | null; onClose(): void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
      toast.success('API key copied')
    } catch {
      inputRef.current?.select()
      toast.info('Copy the selected key with your keyboard', { description: 'This browser blocked clipboard access.' })
    }
  }
  return (
    <Dialog
      open={!!created}
      onOpenChange={(o) => {
        if (!o) {
          setCopied(false)
          onClose()
        }
      }}
      title="Copy your new API key"
      description={created ? `“${created.name}” is ready to use.` : undefined}
      footer={
        <Button
          variant="primary"
          onClick={() => {
            setCopied(false)
            onClose()
          }}
        >
          {copied ? 'Done' : 'I’ve saved it'}
        </Button>
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <Notice tone="warning" title="You won’t see this key again">
            Store it somewhere safe, such as a password manager or your script’s secret store. If you lose it, revoke it and create a new one.
          </Notice>
          <div>
            <label htmlFor="new-api-key" className="mb-1.5 block text-sm font-medium text-ink">
              New API key
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={inputRef}
                id="new-api-key"
                readOnly
                value={created.token}
                spellCheck={false}
                autoComplete="off"
                onFocus={(e) => e.currentTarget.select()}
                className={cn(inputClass, 'font-mono text-sm')}
              />
              <Button variant={copied ? 'subtle' : 'secondary'} icon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} onClick={() => void copy()} className="shrink-0">
                {copied ? 'Copied' : 'Copy key'}
              </Button>
            </div>
          </div>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Scopes</dt>
              <dd className="mt-1">
                <Scopes scopes={created.scopes} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Expires</dt>
              <dd className="mt-1 text-ink">{created.expiresAt ? <DateText value={created.expiresAt} /> : 'Never'}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted">
            Send it as <code className="rounded-sm bg-sunken px-1 font-mono">Authorization: Bearer &lt;key&gt;</code> to this server’s <code className="rounded-sm bg-sunken px-1 font-mono">/api/v1</code>.
          </p>
        </div>
      ) : null}
    </Dialog>
  )
}

// ---- create ------------------------------------------------------------------------

function makeSchema(today: string) {
  return z.object({
    name: z.string().trim().min(1, 'Name the key so you can recognise it later').max(80, 'Use 80 characters or fewer'),
    expiresOn: z.string().refine((v) => v === '' || v >= today, 'Choose today or a later date'),
    scopes: z.array(z.enum(SCOPE_VALUES)).min(1, 'Choose at least one scope'),
  })
}
type CreateValues = z.infer<ReturnType<typeof makeSchema>>
const CREATE_DEFAULTS: CreateValues = { name: '', expiresOn: '', scopes: ['portfolio:read'] }

function ScopeChecklist({ value, onChange, error }: { value: APIKeyScope[]; onChange(v: APIKeyScope[]): void; error?: string }) {
  const errorId = useId()
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="mb-2 text-sm font-medium text-ink">Scopes</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {API_KEY_SCOPES.map((s) => {
          const checked = value.includes(s.scope)
          return (
            <label
              key={s.scope}
              className={cn(
                'grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-md border px-3 py-2.5 transition-colors duration-[var(--dur-1)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]',
                checked ? 'border-accent/50 bg-accent-soft/50' : 'border-line hover:border-line-strong',
              )}
            >
              <input
                type="checkbox"
                className="row-span-2 mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                checked={checked}
                onChange={(e) => onChange(e.target.checked ? SCOPE_VALUES.filter((x) => x === s.scope || value.includes(x)) : value.filter((x) => x !== s.scope))}
              />
              <span className="text-sm font-medium text-ink">{s.label}</span>
              <span className="col-start-2 text-xs text-muted">
                <code className="font-mono">{s.scope}</code> · {s.description}
              </span>
            </label>
          )
        })}
      </div>
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-negative" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

function CreateKeyPanel({ onCreated }: { onCreated(key: CreatedAPIKey): void }) {
  const online = useOnline()
  const { today, timezone } = usePrefs()
  const schema = useMemo(() => makeSchema(today), [today])
  const form = useForm<CreateValues>({ resolver: zodResolver(schema), mode: 'onTouched', defaultValues: CREATE_DEFAULTS })
  const { register, control, handleSubmit, formState, setError, reset } = form
  const create = useApiMutation<CreateAPIKeyRequest, CreatedAPIKey>({
    mutationFn: (body) => api.apiKeys.create(body),
    success: (_k, body) => `API key “${body.name}” created`,
    toastError: false,
    onSuccess: (key) => {
      reset(CREATE_DEFAULTS)
      onCreated(key)
    },
  })
  const onSubmit = handleSubmit((v) => {
    if (create.isPending) return
    create.mutate(
      { name: v.name.trim(), scopes: v.scopes, expiresAt: v.expiresOn ? endOfDayInstant(v.expiresOn, timezone) : null },
      { onError: (err) => applyFieldErrors(err, setError, ['name', 'expiresOn', 'scopes'], { expiresAt: 'expiresOn' }) },
    )
  })
  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel
        title="Create a key"
        description="Give each script or app its own key with only the scopes it needs, so you can revoke one without breaking the others."
        footer={
          <>
            <p className="mr-auto text-xs text-muted">{online ? 'The full key is shown once, right after you create it.' : OFFLINE_REASON}</p>
            <Button type="submit" variant="primary" icon={<KeyRound size={16} aria-hidden />} loading={create.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
              Create API key
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <ProblemNotice error={create.error} />
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <TextField label="Name" autoComplete="off" maxLength={80} placeholder="For example, Monthly spreadsheet" error={formState.errors.name?.message} {...register('name')} />
            <DateField label="Expires on" optional min={today} hint="Leave empty for a key that never expires." error={formState.errors.expiresOn?.message} {...register('expiresOn')} />
          </div>
          <Controller control={control} name="scopes" render={({ field, fieldState }) => <ScopeChecklist value={field.value} onChange={field.onChange} error={fieldState.error?.message} />} />
        </div>
      </SettingsPanel>
    </form>
  )
}

// ---- list --------------------------------------------------------------------------

function KeyTable({ keys, now, onRevoke, online, caption }: { keys: APIKeyMetadata[]; now: number; onRevoke?(k: APIKeyMetadata): void; online: boolean; caption: string }) {
  return (
    <>
      <div className="scroll-x hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Name
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Key
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Scopes
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Created
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Last used
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {onRevoke ? 'Expires' : 'Revoked'}
              </th>
              {onRevoke ? (
                <th scope="col" className="w-12 py-2 pl-2">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-line align-top first:border-t-0">
                <td className="max-w-[14rem] py-2.5 pr-3">
                  <span className="block truncate font-medium text-ink">{k.name}</span>
                </td>
                <td className="px-3 py-2.5">
                  <KeyPrefix prefix={k.prefix} />
                </td>
                <td className="px-3 py-2.5">
                  <Scopes scopes={k.scopes} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                  <DateText value={k.createdAt} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                  <LastUsed value={k.lastUsedAt} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">{onRevoke ? <Expiry k={k} now={now} /> : <DateText value={k.revokedAt} />}</td>
                {onRevoke ? (
                  <td className="py-1 pl-2 text-right">
                    <IconButton label={`Revoke ${k.name}`} icon={<Trash2 size={16} aria-hidden />} disabled={!online} onClick={() => onRevoke(k)} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col divide-y divide-line md:hidden" aria-label={caption}>
        {keys.map((k) => (
          <li key={k.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{k.name}</p>
                <div className="mt-1">
                  <KeyPrefix prefix={k.prefix} />
                </div>
              </div>
              {onRevoke ? <IconButton label={`Revoke ${k.name}`} icon={<Trash2 size={16} aria-hidden />} disabled={!online} onClick={() => onRevoke(k)} /> : null}
            </div>
            <div className="mt-2">
              <Scopes scopes={k.scopes} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Created</dt>
              <dd className="text-ink">
                <DateText value={k.createdAt} />
              </dd>
              <dt className="text-muted">Last used</dt>
              <dd className="text-ink">
                <LastUsed value={k.lastUsedAt} />
              </dd>
              <dt className="text-muted">{onRevoke ? 'Expires' : 'Revoked'}</dt>
              <dd className="text-ink">{onRevoke ? <Expiry k={k} now={now} /> : <DateText value={k.revokedAt} />}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}

function KeysPanel({ keys }: { keys: APIKeyMetadata[] }) {
  const online = useOnline()
  const [now] = useState(() => Date.now())
  const sorted = useMemo(() => [...keys].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)), [keys])
  const active = sorted.filter((k) => !k.revokedAt)
  const revoked = sorted.filter((k) => !!k.revokedAt)
  const [revoking, setRevoking] = useState<APIKeyMetadata | null>(null)
  const [revokeAllOpen, setRevokeAllOpen] = useState(false)

  const revoke = useApiMutation<APIKeyMetadata, void>({
    mutationFn: (k) => api.apiKeys.revoke(k.id),
    success: (_r, k) => `“${k.name}” revoked. Anything using it is signed out now.`,
    toastError: false,
    onSuccess: () => setRevoking(null),
  })
  const revokeAll = useApiMutation<void, { revoked: number }>({
    mutationFn: () => api.apiKeys.revokeAll(),
    success: (r) => (r.revoked === 1 ? '1 API key revoked' : `${r.revoked} API keys revoked`),
    toastError: false,
    onSuccess: () => setRevokeAllOpen(false),
  })

  return (
    <SettingsPanel
      title="API keys"
      description="Personal keys let your own scripts, spreadsheets, and home dashboards use this server’s API as you, limited to the scopes you choose."
      action={
        active.length > 0 ? (
          <Button
            variant="secondary"
            icon={<Trash2 size={16} aria-hidden />}
            disabled={!online}
            title={online ? undefined : OFFLINE_REASON}
            onClick={() => {
              revokeAll.reset()
              setRevokeAllOpen(true)
            }}
          >
            Revoke all
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-md bg-sunken/70 px-3.5 py-3 text-sm text-muted">
          <ShieldCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
          <p>Keys can only be created and revoked here, while you’re signed in. A key can’t manage other keys, change how you sign in, or restore a backup.</p>
        </div>
        {active.length === 0 ? (
          <EmptyState compact icon={<KeyRound size={20} aria-hidden />} title={revoked.length ? 'No active keys' : 'No API keys yet'}>
            Create a key below when a script or app needs to read or update your portfolio.
          </EmptyState>
        ) : (
          <KeyTable keys={active} now={now} online={online} onRevoke={(k) => {
              revoke.reset()
              setRevoking(k)
            }} caption="Active API keys" />
        )}
        {revoked.length > 0 ? (
          <Disclosure label="Revoked keys" count={revoked.length}>
            <KeyTable keys={revoked} now={now} online={online} caption="Revoked API keys" />
          </Disclosure>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => {
          if (!o && !revoke.isPending) setRevoking(null)
        }}
        title={revoking ? `Revoke “${revoking.name}”?` : 'Revoke key?'}
        description="Anything using this key stops working immediately. This can’t be undone; create a new key if you need access again."
        confirmLabel="Revoke key"
        pending={revoke.isPending}
        confirmDisabled={!online}
        onConfirm={() => {
          if (revoking && !revoke.isPending) revoke.mutate(revoking)
        }}
      >
        <ProblemNotice error={revoke.error} />
      </ConfirmDialog>
      <ConfirmDialog
        open={revokeAllOpen}
        onOpenChange={(o) => {
          if (!revokeAll.isPending) setRevokeAllOpen(o)
        }}
        title={`Revoke all ${active.length === 1 ? 'active key' : `${active.length} active keys`}?`}
        description="Every script and app using an API key stops working immediately. Your browser session isn’t affected."
        confirmLabel="Revoke all keys"
        pending={revokeAll.isPending}
        confirmDisabled={!online}
        onConfirm={() => {
          if (!revokeAll.isPending) revokeAll.mutate(undefined)
        }}
      >
        <ProblemNotice error={revokeAll.error} />
      </ConfirmDialog>
    </SettingsPanel>
  )
}

export default function ApiKeysSettings() {
  usePageTitle('API keys')
  const { data, error, isPending, refetch } = useApiKeys()
  const [created, setCreated] = useState<CreatedAPIKey | null>(null)
  return (
    <SettingsStack>
      {isPending ? (
        <ListSkeleton rows={3} />
      ) : error || !data ? (
        <div className="card">
          <ErrorState error={error} onRetry={() => void refetch()} title="API keys could not be loaded" />
        </div>
      ) : (
        <KeysPanel keys={data} />
      )}
      <CreateKeyPanel onCreated={setCreated} />
      <NewKeyDialog created={created} onClose={() => setCreated(null)} />
    </SettingsStack>
  )
}
