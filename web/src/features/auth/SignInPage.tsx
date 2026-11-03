import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { api } from '@/api'
import { ApiProblem } from '@/api/problem'
import type { AuthConfig, SessionResponse } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { Spinner } from '@/components/ui/Spinner'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useSession } from '@/lib/session'
import { usePageTitle } from '@/lib/usePageTitle'
import { AuthCard, AuthLayout } from './AuthLayout'
import { AuthCardSkeleton, OrDivider, safeNext } from './auth-kit'
import { signInOidcMessage } from './oidc-messages'
import { PasswordField } from './PasswordField'

/** Build-time flag: production builds drop every mock-only branch (demo credentials, simulated SSO). */
const IS_MOCK = import.meta.env.VITE_DATA_SOURCE === 'mock'

export const GENERIC_SIGN_IN_ERROR = 'That username and password don’t match. Check them and try again.'

/** Never reveal whether a username exists: every credential failure gets the same message. */
function signInErrorMessage(error: unknown): string {
  if (ApiProblem.is(error) && (error.status === 0 || error.status >= 500)) return 'The server could not be reached. Check your connection and try again.'
  return GENERIC_SIGN_IN_ERROR
}

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
})
type Values = z.infer<typeof schema>

function useCompleteSignIn(next: string) {
  const { setSession } = useSession()
  const navigate = useNavigate()
  return (session: SessionResponse) => {
    setSession(session)
    navigate(next, { replace: true })
  }
}

function SsoButton({ config, next, primary }: { config: AuthConfig; next: string; primary: boolean }) {
  const online = useOnline()
  const complete = useCompleteSignIn(next)
  const sso = useMutation({ mutationFn: () => api.auth.completeMockOidc!(), onSuccess: complete })
  const start = () => {
    if (IS_MOCK && api.auth.completeMockOidc) sso.mutate()
    else window.location.assign(api.auth.oidcStartUrl(next))
  }
  return (
    <div className="flex flex-col gap-3">
      <Button variant={primary ? 'primary' : 'secondary'} size="lg" className="w-full" icon={<KeyRound size={18} aria-hidden />} loading={sso.isPending} disabled={!online} onClick={start}>
        Continue with {config.providerName}
      </Button>
      {sso.isError ? (
        <Notice tone="negative" role="alert" title="Single sign-on didn’t finish">
          Try again. If it keeps failing, check that {config.providerName} is available.
        </Notice>
      ) : null}
    </div>
  )
}

function PasswordForm({ next }: { next: string }) {
  const online = useOnline()
  const complete = useCompleteSignIn(next)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { username: '', password: '' } })
  const { register, handleSubmit, formState, setValue, setFocus } = form
  const login = useMutation({
    mutationFn: (v: Values) => api.auth.login({ username: v.username.trim(), password: v.password }),
    onSuccess: complete,
    onError: () => {
      setValue('password', '')
      setFocus('password')
    },
  })
  const onSubmit = handleSubmit((v) => {
    if (login.isPending) return
    login.mutate(v)
  })
  const fillDemo = () => {
    setValue('username', 'amani', { shouldValidate: true })
    setValue('password', 'wealthboard-demo', { shouldValidate: true })
    setFocus('password')
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Sign in with your username">
      {login.isError ? (
        <Notice tone="negative" role="alert" title="Sign-in didn’t work">
          {signInErrorMessage(login.error)}
        </Notice>
      ) : null}
      <TextField label="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} error={formState.errors.username?.message} {...register('username')} />
      <PasswordField label="Password" autoComplete="current-password" error={formState.errors.password?.message} {...register('password')} />
      <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" loading={login.isPending} disabled={!online}>
        Sign in
      </Button>
      {!online ? <p className="text-center text-xs text-warning">{OFFLINE_REASON}</p> : null}
      {IS_MOCK ? (
        <p className="flex flex-wrap items-center justify-center gap-x-2 rounded-md bg-sunken/70 px-3 py-2 text-center text-xs text-muted">
          <span>
            Demo profile: <span className="font-medium text-ink">amani</span> · <span className="font-medium text-ink">wealthboard-demo</span>
          </span>
          <button type="button" onClick={fillDemo} className="link font-medium">
            Fill in
          </button>
        </p>
      ) : null}
    </form>
  )
}

/** Handles the ?mock-oidc=1 return leg of the simulated SSO round trip (mock adapter only). */
function MockOidcReturn({ next }: { next: string }) {
  const complete = useCompleteSignIn(next)
  const started = useRef(false)
  const { mutate, isError } = useMutation({ mutationFn: () => api.auth.completeMockOidc!(), onSuccess: complete })
  useEffect(() => {
    if (started.current) return
    started.current = true
    mutate()
  }, [mutate])
  if (isError)
    return (
      <Notice tone="negative" role="alert" title="Single sign-on didn’t finish">
        <Link to="/sign-in" className="link">
          Start again
        </Link>
      </Notice>
    )
  return (
    <div className="flex items-center gap-3 py-4 text-sm text-muted" role="status">
      <Spinner size={18} />
      Finishing single sign-on…
    </div>
  )
}

export default function SignInPage() {
  usePageTitle('Sign in')
  const [params, setParams] = useSearchParams()
  const next = safeNext(params.get('next'))
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api.auth.config(), staleTime: 5 * 60_000 })
  const mockReturn = params.get('mock-oidc') === '1' && IS_MOCK && !!api.auth.completeMockOidc
  // The server sends failed provider sign-ins back with ?oidc_error=<code>: keep the message, drop the parameter.
  const [oidcError] = useState(() => params.get('oidc_error'))
  useEffect(() => {
    if (!params.has('oidc_error')) return
    setParams(
      (p) => {
        const nextParams = new URLSearchParams(p)
        nextParams.delete('oidc_error')
        return nextParams
      },
      { replace: true },
    )
  }, [params, setParams])
  const oidcMessage = oidcError ? signInOidcMessage(oidcError, config.data?.providerName) : null
  const oidcNotice = oidcMessage ? (
    <Notice tone="negative" role="alert" title={oidcMessage.title}>
      {oidcMessage.body}
    </Notice>
  ) : null

  let body
  if (mockReturn) {
    body = (
      <AuthCard title="Signing you in" description="Your identity provider confirmed it’s you.">
        <MockOidcReturn next={next} />
      </AuthCard>
    )
  } else if (config.isPending) {
    body = <AuthCardSkeleton />
  } else if (config.isError) {
    body = (
      <div className="card">
        <ErrorState error={config.error} onRetry={() => void config.refetch()} title="Sign-in options could not be loaded" />
      </div>
    )
  } else {
    const c = config.data
    const ssoOnly = !c.localEnabled && c.oidcEnabled
    const noMethods = !c.localEnabled && !c.oidcEnabled
    body = (
      <AuthCard
        title="Welcome back"
        description={ssoOnly ? `This server signs you in through ${c.providerName}.` : 'Sign in to your private portfolio.'}
        footer={
          c.localEnabled ? (
            <>
              New here?{' '}
              <Link to="/sign-up" className="link font-medium">
                Create a profile
              </Link>
            </>
          ) : null
        }
      >
        {oidcNotice ? <div className="mb-5">{oidcNotice}</div> : null}
        {noMethods ? (
          <Notice tone="warning" title="Sign-in is turned off">
            Ask whoever runs this server to enable a sign-in method.
          </Notice>
        ) : ssoOnly ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3 rounded-md bg-sunken/70 px-3.5 py-3 text-sm text-muted">
              <ShieldCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
              <p>You’ll be sent to {c.providerName} to confirm it’s you, then brought straight back. Your password is never shared with this app.</p>
            </div>
            <SsoButton config={c} next={next} primary />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {c.oidcEnabled ? (
              <>
                <SsoButton config={c} next={next} primary={false} />
                <OrDivider />
              </>
            ) : null}
            <PasswordForm next={next} />
          </div>
        )}
      </AuthCard>
    )
  }

  return <AuthLayout>{body}</AuthLayout>
}
