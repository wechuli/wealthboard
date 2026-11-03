import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ShieldCheck } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { z } from 'zod'
import { api } from '@/api'
import type { SignupRequest } from '@/api/types'
import { buttonClass, Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextField } from '@/components/ui/Field'
import { CURRENCIES, DEFAULT_BASE_CURRENCY } from '@/lib/currency'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useSession } from '@/lib/session'
import { usePageTitle } from '@/lib/usePageTitle'
import { ProblemNotice, applyFieldErrors } from '@/features/settings/settings-kit'
import { AuthCard, AuthLayout } from './AuthLayout'
import { AuthCardSkeleton } from './auth-kit'
import { MIN_PASSWORD, PasswordField, PasswordStrength } from './PasswordField'

const USERNAME_RE = /^[a-z0-9._-]+$/

const schema = z
  .object({
    username: z
      .string()
      .min(3, 'Use at least 3 characters')
      .max(32, 'Use 32 characters or fewer')
      .regex(USERNAME_RE, 'Use only letters, numbers, dots, underscores, or hyphens'),
    displayName: z.string().trim().min(1, 'Enter the name you’d like to see').max(80, 'Use 80 characters or fewer'),
    password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`).max(256, 'Use 256 characters or fewer'),
    confirmPassword: z.string().min(1, 'Type the password again'),
    baseCurrency: z.string().length(3, 'Choose a currency'),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'The passwords don’t match' })
type Values = z.infer<typeof schema>

function SignUpForm() {
  const online = useOnline()
  const { setSession } = useSession()
  const navigate = useNavigate()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { username: '', displayName: '', password: '', confirmPassword: '', baseCurrency: DEFAULT_BASE_CURRENCY },
  })
  const { register, control, handleSubmit, formState, setError, trigger } = form
  const [username, password] = useWatch({ control, name: ['username', 'password'] })
  const signup = useMutation({
    mutationFn: (body: SignupRequest) => api.auth.signup(body),
    onSuccess: (session) => {
      setSession(session)
      navigate('/', { replace: true })
    },
  })

  const onSubmit = handleSubmit((v) => {
    if (signup.isPending) return
    signup.mutate(
      { username: v.username, displayName: v.displayName.trim(), password: v.password, confirmPassword: v.confirmPassword, baseCurrency: v.baseCurrency },
      { onError: (err) => applyFieldErrors(err, setError, ['username', 'displayName', 'password', 'confirmPassword', 'baseCurrency']) },
    )
  })

  const usernameOk = !formState.errors.username && username.length >= 3 && USERNAME_RE.test(username)

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Create your profile">
      <ProblemNotice error={signup.error} />
      <Controller
        control={control}
        name="username"
        render={({ field, fieldState }) => (
          <TextField
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            error={fieldState.error?.message}
            hint={
              usernameOk ? (
                <span className="inline-flex items-center gap-1 text-positive">
                  <Check size={13} aria-hidden /> You’ll sign in as <span className="font-medium">{username}</span>
                </span>
              ) : (
                '3–32 characters: letters, numbers, dots, underscores, or hyphens. It can’t be changed later.'
              )
            }
            name={field.name}
            ref={field.ref}
            value={field.value}
            onBlur={field.onBlur}
            onChange={(e) => {
              const lower = e.target.value.toLowerCase().replace(/\s/g, '')
              field.onChange(lower)
              if (lower.length >= 3 || !USERNAME_RE.test(lower || 'a') || fieldState.isTouched) void trigger('username')
            }}
          />
        )}
      />
      <TextField label="Display name" autoComplete="name" placeholder="For example, Amani Wanjiru" error={formState.errors.displayName?.message} {...register('displayName')} />
      <div>
        <PasswordField label="Password" autoComplete="new-password" error={formState.errors.password?.message} {...register('password')} />
        {!formState.errors.password ? <PasswordStrength value={password} /> : null}
      </div>
      <PasswordField label="Confirm password" autoComplete="new-password" error={formState.errors.confirmPassword?.message} {...register('confirmPassword')} />
      <SelectField
        label="Base currency"
        options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
        hint="Your net worth and totals are shown in this currency. You can change it later."
        error={formState.errors.baseCurrency?.message}
        {...register('baseCurrency')}
      />
      <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" loading={signup.isPending} disabled={!online}>
        Create profile
      </Button>
      {!online ? <p className="text-center text-xs text-warning">{OFFLINE_REASON}</p> : null}
      <p className="text-center text-xs text-muted">Your portfolio starts empty and private. Nothing is shared with anyone else on this server.</p>
    </form>
  )
}

export default function SignUpPage() {
  usePageTitle('Create a profile')
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api.auth.config(), staleTime: 5 * 60_000 })

  let body
  if (config.isPending) body = <AuthCardSkeleton />
  else if (config.isError)
    body = (
      <div className="card">
        <ErrorState error={config.error} onRetry={() => void config.refetch()} title="Sign-up options could not be loaded" />
      </div>
    )
  else if (!config.data.localEnabled)
    body = (
      <AuthCard title="Profiles come from single sign-on" description={`This server doesn’t use passwords. Your profile is created the first time you sign in with ${config.data.providerName}.`}>
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-md bg-sunken/70 px-3.5 py-3 text-sm text-muted">
            <ShieldCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
            <p>Each profile is private: nobody else on this server can see your accounts or figures.</p>
          </div>
          <Link to="/sign-in" className={buttonClass({ variant: 'primary', size: 'lg', className: 'w-full' })}>
            Go to sign in
          </Link>
        </div>
      </AuthCard>
    )
  else
    body = (
      <AuthCard
        title="Create your profile"
        description="A private portfolio on this server, just for you."
        footer={
          <>
            Already have a profile?{' '}
            <Link to="/sign-in" className="link font-medium">
              Sign in
            </Link>
          </>
        }
      >
        <SignUpForm />
      </AuthCard>
    )

  return <AuthLayout>{body}</AuthLayout>
}
