import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Check, KeyRound, Link2, Link2Off, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { z } from 'zod'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { AuthConfig, ChangePasswordRequest, EnableLocalCredentialRequest, SessionResponse, SettingsRead } from '@/api/types'
import { DateText } from '@/components/format'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass, IconButton } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useAuthConfig } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { usePageTitle } from '@/lib/usePageTitle'
import { settingsOidcMessage } from '@/features/auth/oidc-messages'
import { MIN_PASSWORD, PasswordField, PasswordStrength } from '@/features/auth/PasswordField'
import { applyFieldErrors, ProblemNotice, SaveFooter, SettingsPanel, SettingsStack, useSaveSettings, wholeNumberInRange, WithSettings } from './settings-kit'

// ---- change password -----------------------------------------------------------

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`).max(256, 'Use 256 characters or fewer'),
    confirmPassword: z.string().min(1, 'Type the new password again'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'The passwords don’t match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password different from your current one' })
type PasswordValues = z.infer<typeof passwordSchema>

const EMPTY: PasswordValues = { currentPassword: '', newPassword: '', confirmPassword: '' }

function ChangePasswordForm() {
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), mode: 'onTouched', defaultValues: EMPTY })
  const { register, handleSubmit, formState, setError, reset, control } = form
  const newPassword = useWatch({ control, name: 'newPassword' })
  const { user } = useSession()
  const change = useApiMutation<ChangePasswordRequest, void>({
    mutationFn: (body) => api.auth.changePassword(body),
    success: 'Password changed. Use it next time you sign in.',
    toastError: false,
    onSuccess: () => reset(EMPTY),
  })

  const onSubmit = handleSubmit((v) => {
    if (change.isPending) return
    change.mutate(v, {
      onError: (err) => {
        if (ApiProblem.is(err) && err.status === 401) setError('currentPassword', { type: 'server', message: err.detail || 'The current password is incorrect.' }, { shouldFocus: true })
        else applyFieldErrors(err, setError, ['currentPassword', 'newPassword', 'confirmPassword'])
      },
    })
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel
        title="Change password"
        description="You’ll stay signed in here. Every other device and browser is signed out and needs the new password."
        footer={<SaveFooter pending={change.isPending} dirty={formState.isDirty} label="Change password" />}
      >
        <div className="flex max-w-md flex-col gap-5">
          <ProblemNotice error={change.error} />
          {/* A hidden username helps password managers pair the new password with the right login. */}
          <input type="text" name="username" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
          <PasswordField label="Current password" autoComplete="current-password" error={formState.errors.currentPassword?.message} {...register('currentPassword')} />
          <div>
            <PasswordField label="New password" autoComplete="new-password" error={formState.errors.newPassword?.message} {...register('newPassword')} />
            {!formState.errors.newPassword ? <PasswordStrength value={newPassword} /> : null}
          </div>
          <PasswordField label="Confirm new password" autoComplete="new-password" error={formState.errors.confirmPassword?.message} {...register('confirmPassword')} />
        </div>
      </SettingsPanel>
    </form>
  )
}


// ---- sign-in methods ---------------------------------------------------------------

const REAUTH_RETURN = '/settings/security?reauthenticated=1'

/** Reads the server's return parameters once (?auth=<code>, ?reauthenticated=1), then removes them from the URL. */
function useProviderReturn() {
  const [params, setParams] = useSearchParams()
  const [feedback, setFeedback] = useState(() => params.get('auth'))
  const [reauthenticated, setReauthenticated] = useState(() => params.get('reauthenticated') === '1')
  useEffect(() => {
    if (!params.has('auth') && !params.has('reauthenticated')) return
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('auth')
        next.delete('reauthenticated')
        return next
      },
      { replace: true },
    )
  }, [params, setParams])
  return {
    feedback,
    dismissFeedback: () => setFeedback(null),
    reauthenticated,
    consumeReauthentication: () => setReauthenticated(false),
  }
}

type ProviderReturn = ReturnType<typeof useProviderReturn>

function MethodRow({ icon, name, state, detail }: { icon: ReactNode; name: string; state: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken text-muted">{icon}</span>
      <div className="min-w-0 flex-1 basis-48">
        <dt className="text-sm font-medium text-ink">{name}</dt>
        {detail ? <dd className="mt-0.5 text-xs text-muted">{detail}</dd> : null}
      </div>
      <dd className="shrink-0">{state}</dd>
    </div>
  )
}

const on = (label: string) => (
  <Badge tone="positive" icon={<Check size={12} aria-hidden />}>
    {label}
  </Badge>
)
const off = (label: string, title?: string) => (
  <Badge tone="neutral" title={title}>
    {label}
  </Badge>
)

/** Current password field shared by the link and unlink forms. */
const currentPasswordSchema = z.object({ currentPassword: z.string().min(1, 'Enter your current password') })
type CurrentPasswordValues = z.infer<typeof currentPasswordSchema>

function useCurrentPasswordForm() {
  return useForm<CurrentPasswordValues>({ resolver: zodResolver(currentPasswordSchema), mode: 'onTouched', defaultValues: { currentPassword: '' } })
}

function wrongPassword(err: unknown, set: (message: string) => void): boolean {
  if (ApiProblem.is(err) && err.status === 401) {
    set(err.detail || 'The current password is incorrect.')
    return true
  }
  return false
}

function LinkProviderForm({ provider }: { provider: string }) {
  const online = useOnline()
  const { register, handleSubmit, formState, setError } = useCurrentPasswordForm()
  const link = useApiMutation<string, void>({ mutationFn: (pw) => api.auth.linkOidc(pw), toastError: false })
  const onSubmit = handleSubmit((v) => {
    if (link.isPending) return
    link.mutate(v.currentPassword, { onError: (err) => wrongPassword(err, (message) => setError('currentPassword', { type: 'server', message }, { shouldFocus: true })) })
  })
  const showProblem = link.error && !(ApiProblem.is(link.error) && link.error.status === 401)
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Link {provider}</h3>
        <p className="mt-0.5 max-w-[60ch] text-sm text-muted">Confirm your password, then sign in with {provider}. Afterwards you can use either one to sign in.</p>
      </div>
      {showProblem ? <ProblemNotice error={link.error} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <PasswordField label="Current password" autoComplete="current-password" className="min-w-0 flex-1 basis-60 sm:max-w-xs" error={formState.errors.currentPassword?.message} {...register('currentPassword')} />
        <Button type="submit" variant="primary" icon={<Link2 size={16} aria-hidden />} loading={link.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
          Continue to {provider}
        </Button>
      </div>
    </form>
  )
}

function UnlinkProviderForm({ provider, onSession }: { provider: string; onSession(s: SessionResponse): void }) {
  const online = useOnline()
  const { register, handleSubmit, formState, setError } = useCurrentPasswordForm()
  const unlink = useApiMutation<string, SessionResponse>({
    mutationFn: (pw) => api.auth.unlinkOidc(pw),
    success: `${provider} unlinked. Sign in with your username and password from now on.`,
    toastError: false,
    onSuccess: onSession,
  })
  const onSubmit = handleSubmit((v) => {
    if (unlink.isPending) return
    unlink.mutate(v.currentPassword, { onError: (err) => wrongPassword(err, (message) => setError('currentPassword', { type: 'server', message }, { shouldFocus: true })) })
  })
  const showProblem = unlink.error && !(ApiProblem.is(unlink.error) && unlink.error.status === 401)
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Unlink {provider}</h3>
        <p className="mt-0.5 max-w-[60ch] text-sm text-muted">You’ll sign in with your username and password only. Other devices are signed out.</p>
      </div>
      {showProblem ? <ProblemNotice error={unlink.error} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <PasswordField label="Current password" autoComplete="current-password" className="min-w-0 flex-1 basis-60 sm:max-w-xs" error={formState.errors.currentPassword?.message} {...register('currentPassword')} />
        <Button type="submit" icon={<Link2Off size={16} aria-hidden />} loading={unlink.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
          Unlink {provider}
        </Button>
      </div>
    </form>
  )
}

/** Starts a fresh provider verification; the provider sends the browser back with ?reauthenticated=1. */
function VerifyWithProvider({ provider, title, children }: { provider: string; title: string; children: ReactNode }) {
  const online = useOnline()
  const verify = useApiMutation<void, void>({ mutationFn: () => api.auth.reauthenticateOidc(REAUTH_RETURN), toastError: false })
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 max-w-[60ch] text-sm text-muted">{children}</p>
      </div>
      <ProblemNotice error={verify.error} />
      <div>
        <Button icon={<ShieldCheck size={16} aria-hidden />} loading={verify.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON} onClick={() => verify.mutate(undefined)}>
          Verify with {provider}
        </Button>
      </div>
    </div>
  )
}

/** The provider verification is single-use and short-lived; when the server rejects it, offer to verify again. */
function ReauthProblem({ error, provider, onExpired }: { error: unknown; provider: string; onExpired(): void }) {
  if (ApiProblem.is(error) && error.status === 401)
    return (
      <Notice
        tone="warning"
        role="alert"
        title="Verification expired"
        action={
          <Button size="sm" onClick={onExpired}>
            Verify again
          </Button>
        }
      >
        Verify with {provider} again, then finish within a few minutes.
      </Notice>
    )
  return <ProblemNotice error={error} />
}

function VerifiedNote({ provider }: { provider: string }) {
  return (
    <Notice tone="positive" role="status" title={`${provider} verified it’s you`}>
      This verification works once and expires after a few minutes.
    </Notice>
  )
}

const enableSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'Use at least 3 characters')
      .max(32, 'Use 32 characters or fewer')
      .regex(/^[a-z0-9._-]+$/, 'Use only letters, numbers, dots, underscores, or hyphens'),
    password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`).max(256, 'Use 256 characters or fewer'),
    confirmPassword: z.string().min(1, 'Type the password again'),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'The passwords don’t match' })
type EnableValues = z.infer<typeof enableSchema>

function EnableLocalForm({ provider, onSession, onExpired }: { provider: string; onSession(s: SessionResponse): void; onExpired(): void }) {
  const online = useOnline()
  const { user } = useSession()
  const form = useForm<EnableValues>({ resolver: zodResolver(enableSchema), mode: 'onTouched', defaultValues: { username: user?.username ?? '', password: '', confirmPassword: '' } })
  const { register, handleSubmit, formState, control, setError } = form
  const password = useWatch({ control, name: 'password' })
  const enable = useApiMutation<EnableLocalCredentialRequest, SessionResponse>({
    mutationFn: (body) => api.auth.enableLocalCredential(body),
    success: 'Password sign-in added. You can now sign in either way.',
    toastError: false,
    onSuccess: onSession,
  })
  const onSubmit = handleSubmit((v) => {
    if (enable.isPending) return
    enable.mutate(v, { onError: (err) => applyFieldErrors(err, setError, ['username', 'password', 'confirmPassword']) })
  })
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Add a username and password</h3>
        <p className="mt-0.5 max-w-[60ch] text-sm text-muted">A second way in, for when {provider} is unavailable. Other devices are signed out once it’s added.</p>
      </div>
      <VerifiedNote provider={provider} />
      <ReauthProblem error={enable.error} provider={provider} onExpired={onExpired} />
      <div className="flex max-w-md flex-col gap-5">
        <TextField label="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} hint="3–32 lowercase letters, numbers, dots, underscores, or hyphens." error={formState.errors.username?.message} {...register('username')} />
        <div>
          <PasswordField label="Password" autoComplete="new-password" error={formState.errors.password?.message} {...register('password')} />
          {!formState.errors.password ? <PasswordStrength value={password} /> : null}
        </div>
        <PasswordField label="Confirm password" autoComplete="new-password" error={formState.errors.confirmPassword?.message} {...register('confirmPassword')} />
      </div>
      <div>
        <Button type="submit" variant="primary" icon={<KeyRound size={16} aria-hidden />} loading={enable.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
          Add password sign-in
        </Button>
      </div>
    </form>
  )
}

function RemoveLocalSection({ provider, onSession, onExpired }: { provider: string; onSession(s: SessionResponse): void; onExpired(): void }) {
  const online = useOnline()
  const [confirming, setConfirming] = useState(false)
  const remove = useApiMutation<void, SessionResponse>({
    mutationFn: () => api.auth.removeLocalCredential(),
    success: `Password sign-in removed. Sign in with ${provider} from now on.`,
    toastError: false,
    onSuccess: (session) => {
      setConfirming(false)
      onSession(session)
    },
  })
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Remove password sign-in</h3>
        <p className="mt-0.5 max-w-[60ch] text-sm text-muted">{provider} becomes the only way to sign in. Other devices are signed out.</p>
      </div>
      <VerifiedNote provider={provider} />
      {!confirming ? <ReauthProblem error={remove.error} provider={provider} onExpired={onExpired} /> : null}
      <div>
        <Button
          variant="danger"
          icon={<KeyRound size={16} aria-hidden />}
          disabled={!online}
          title={online ? undefined : OFFLINE_REASON}
          onClick={() => {
            remove.reset()
            setConfirming(true)
          }}
        >
          Remove password sign-in
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!remove.isPending) setConfirming(o)
        }}
        title="Remove your password?"
        description={`You’ll only be able to sign in with ${provider}. If ${provider} is unavailable, you won’t be able to sign in until it’s back.`}
        confirmLabel="Remove password"
        pending={remove.isPending}
        confirmDisabled={!online}
        onConfirm={() => {
          if (!remove.isPending) remove.mutate(undefined)
        }}
      >
        <ReauthProblem error={remove.error} provider={provider} onExpired={onExpired} />
      </ConfirmDialog>
    </div>
  )
}

function SignInMethodsPanel({ data, config, providerReturn }: { data: SettingsRead; config: AuthConfig; providerReturn: ProviderReturn }) {
  const { setSession } = useSession()
  const provider = config.providerName.trim() || 'Single sign-on'
  const hybrid = config.localEnabled && config.oidcEnabled
  const { hasPassword } = data.authMethods
  const identity = data.authMethods.oidcIdentities[0]
  const linked = !!identity
  const { feedback, dismissFeedback, reauthenticated, consumeReauthentication } = providerReturn
  const message = feedback ? settingsOidcMessage(feedback, config.providerName) : null
  const onSession = (session: SessionResponse) => {
    consumeReauthentication()
    setSession(session)
  }
  const verifyAgain = () => {
    consumeReauthentication()
    void api.auth.reauthenticateOidc(REAUTH_RETURN).catch(() => undefined)
  }

  let actions: ReactNode = null
  if (hybrid && hasPassword && !linked) actions = <LinkProviderForm provider={provider} />
  else if (hybrid && hasPassword && linked)
    actions = (
      <>
        <UnlinkProviderForm provider={provider} onSession={onSession} />
        <div className="border-t border-line" />
        {reauthenticated ? (
          <RemoveLocalSection provider={provider} onSession={onSession} onExpired={verifyAgain} />
        ) : (
          <VerifyWithProvider provider={provider} title="Remove password sign-in">
            To use only {provider}, first verify with {provider}. You’ll come straight back here to confirm.
          </VerifyWithProvider>
        )}
      </>
    )
  else if (hybrid && !hasPassword && linked)
    actions = reauthenticated ? (
      <EnableLocalForm provider={provider} onSession={onSession} onExpired={verifyAgain} />
    ) : (
      <VerifyWithProvider provider={provider} title="Add a username and password">
        A second way in, for when {provider} is unavailable. First verify with {provider}; you’ll come straight back here to choose a password.
      </VerifyWithProvider>
    )

  return (
    <SettingsPanel title="Sign-in methods" description="How you prove it’s you when you sign in to this server.">
      <div className="flex flex-col gap-6">
        {message ? (
          <Notice tone="negative" role="alert" title={message.title} action={<IconButton label="Dismiss" icon={<X size={16} aria-hidden />} size="sm" onClick={dismissFeedback} />}>
            {message.body}
          </Notice>
        ) : null}
        <dl className="flex flex-col divide-y divide-line">
          <MethodRow
            icon={<KeyRound size={18} aria-hidden />}
            name="Username and password"
            state={!config.localEnabled ? off('Unavailable', 'Password sign-in is turned off on this server') : hasPassword ? on('On') : off('Off')}
            detail={!config.localEnabled ? 'Turned off on this server.' : hasPassword ? 'You can sign in with your username and password.' : 'No password is set for this profile.'}
          />
          <MethodRow
            icon={<ShieldCheck size={18} aria-hidden />}
            name={config.oidcEnabled ? provider : 'Single sign-on'}
            state={!config.oidcEnabled ? off('Not set up', 'Single sign-on is not configured on this server') : linked ? on('Linked') : off('Not linked')}
            detail={
              !config.oidcEnabled ? (
                'Not configured on this server.'
              ) : linked ? (
                <>
                  Linked <DateText value={identity.createdAt} />
                  {identity.lastLoginAt ? (
                    <>
                      {' · last used '}
                      <DateText value={identity.lastLoginAt} />
                    </>
                  ) : null}
                </>
              ) : (
                `You can link ${provider} to sign in without a password.`
              )
            }
          />
        </dl>
        {actions ? <div className="flex flex-col gap-6 border-t border-line pt-6">{actions}</div> : null}
      </div>
    </SettingsPanel>
  )
}

function SsoNotice({ providerName }: { providerName: string }) {
  return (
    <SettingsPanel title="Password" description="Your password lives with your identity provider.">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <ShieldCheck size={20} aria-hidden />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink">Sign-in is managed by {providerName}</p>
          <p className="mt-1 max-w-[56ch] text-muted">
            You don’t have a separate password here. To change your password or add two-step verification, do it in {providerName}; it applies the next time you sign in.
          </p>
        </div>
      </div>
    </SettingsPanel>
  )
}

function SignInSection({ data, providerReturn }: { data: SettingsRead; providerReturn: ProviderReturn }) {
  const config = useAuthConfig()
  if (config.isPending)
    return (
      <div className="card px-5 py-5 md:px-6 md:py-6" role="status" aria-label="Loading">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        <Skeleton className="mt-6 h-10 w-full max-w-md" />
        <Skeleton className="mt-4 h-10 w-full max-w-md" />
      </div>
    )
  if (config.isError)
    return (
      <Notice tone="warning" title="Sign-in options could not be loaded" action={<button type="button" className={buttonClass({ size: 'sm' })} onClick={() => void config.refetch()}>Try again</button>}>
        Your sign-in methods and the password form appear once the server confirms which methods are turned on.
      </Notice>
    )
  const c = config.data
  return (
    <>
      <SignInMethodsPanel data={data} config={c} providerReturn={providerReturn} />
      {c.localEnabled && data.authMethods.hasPassword ? <ChangePasswordForm /> : !c.localEnabled && c.oidcEnabled ? <SsoNotice providerName={c.providerName.trim() || 'your identity provider'} /> : null}
    </>
  )
}

// ---- session timeout -------------------------------------------------------------

const MIN_TIMEOUT = 15
const MAX_TIMEOUT = 525_600

const timeoutSchema = z.object({
  minutes: z
    .string()
    .trim()
    .refine((v) => wholeNumberInRange(v, MIN_TIMEOUT, MAX_TIMEOUT), 'Use a whole number of minutes from 15 to 525,600 (365 days)'),
})
type TimeoutValues = z.infer<typeof timeoutSchema>

const plural = (n: number, unit: string) => `${n.toLocaleString('en-US')} ${unit}${n === 1 ? '' : 's'}`

export function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const parts = [days ? plural(days, 'day') : '', hours ? plural(hours, 'hour') : '', mins ? plural(mins, 'minute') : ''].filter(Boolean)
  return parts.join(' ') || plural(0, 'minute')
}

const TIMEOUT_PRESETS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '1 day' },
  { minutes: 10_080, label: '7 days' },
  { minutes: 43_200, label: '30 days' },
]

function SessionTimeoutForm({ data }: { data: SettingsRead }) {
  const current = data.settings.sessionTimeoutMinutes
  const form = useForm<TimeoutValues>({ resolver: zodResolver(timeoutSchema), mode: 'onTouched', defaultValues: { minutes: String(current) } })
  const { register, handleSubmit, formState, setError, reset, control, setValue } = form
  const minutes = useWatch({ control, name: 'minutes' })
  const save = useSaveSettings('Session timeout saved', (p) => reset({ minutes: String(p.sessionTimeoutMinutes ?? current) }))
  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    save.mutate({ sessionTimeoutMinutes: Number(v.minutes) }, { onError: (err) => applyFieldErrors(err, setError, ['minutes'], { sessionTimeoutMinutes: 'minutes' }) })
  })
  const valid = wholeNumberInRange(minutes.trim(), MIN_TIMEOUT, MAX_TIMEOUT)
  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel
        title="Session timeout"
        description="After this long without activity you’re signed out, and anyone using this device would need to sign in again to see your portfolio."
        footer={<SaveFooter pending={save.isPending} dirty={formState.isDirty} />}
      >
        <div className="flex flex-col gap-4">
          <ProblemNotice error={save.error} />
          <div className="max-w-56">
            <TextField
              label="Minutes of inactivity"
              inputMode="numeric"
              autoComplete="off"
              error={formState.errors.minutes?.message}
              hint={valid ? `Signs you out after ${formatDuration(Number(minutes.trim()))}.` : 'Between 15 minutes and 365 days.'}
              {...register('minutes')}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Common timeouts">
            {TIMEOUT_PRESETS.map((p) => (
              <Button key={p.minutes} size="sm" variant={minutes.trim() === String(p.minutes) ? 'subtle' : 'ghost'} aria-pressed={minutes.trim() === String(p.minutes)} onClick={() => setValue('minutes', String(p.minutes), { shouldDirty: true, shouldValidate: true })}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </SettingsPanel>
    </form>
  )
}

function ApiKeysLink() {
  return (
    <SettingsPanel
      title="API keys"
      description="Scoped personal keys let your own scripts and spreadsheets use this server’s API. Create and revoke them while signed in here."
      action={
        <Link to="/settings/api-keys" className={buttonClass({ variant: 'secondary' })}>
          <KeyRound size={16} aria-hidden />
          Manage API keys
          <ArrowRight size={15} aria-hidden />
        </Link>
      }
    />
  )
}

export default function SecuritySettings() {
  usePageTitle('Security')
  const providerReturn = useProviderReturn()
  return (
    <WithSettings panels={2}>
      {(data) => (
        <SettingsStack>
          <SignInSection data={data} providerReturn={providerReturn} />
          <SessionTimeoutForm data={data} />
          <ApiKeysLink />
        </SettingsStack>
      )}
    </WithSettings>
  )
}
