import {
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { z } from "zod";

import type { AuthConfig, Session } from "../types";
import { Button } from "./button";
import { CURRENCY_CATALOG, DEFAULT_BASE_CURRENCY } from "./currencies";
import { FieldError, Input, Label, Select } from "./form-controls";

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "Enter a valid username."),
  password: z.string().min(1, "Enter your password.").max(256),
});

const signupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,32}$/, "Enter a valid username."),
    displayName: z.string().trim().min(1, "Enter a display name.").max(80),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/, "Choose a base currency."),
    password: z.string().min(12, "Use at least 12 characters.").max(256),
    confirmPassword: z.string().max(256),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
type FieldErrors = Record<string, string[] | undefined>;

function AuthFrame({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer: string;
  children: ReactNode;
}) {
  return (
    <main className="financial-grid flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[var(--panel)] p-7 shadow-2xl sm:p-9">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-950/40">
          <BarChart3 size={24} strokeWidth={2.4} />
        </div>
        <p className="mt-7 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
          Wealthboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
        {children}
        <div className="mt-7 flex items-center gap-2 border-t border-white/[0.07] pt-5 text-xs text-slate-500">
          <ShieldCheck size={15} />
          {footer}
        </div>
      </section>
    </main>
  );
}

export function LoginScreen({
  config,
  authenticate,
  onAuthenticated,
}: {
  config: AuthConfig;
  authenticate: (input: LoginInput) => Promise<Session>;
  onAuthenticated: (session: Session) => void;
}) {
  const query = new URLSearchParams(window.location.search);
  const oidcErrors: Record<string, string> = {
    unavailable: "Provider sign-in is temporarily unavailable. Try again later.",
    provider: "Provider sign-in was cancelled or rejected.",
    invalid_callback: "The provider response could not be verified. Try again.",
    access_denied: "Sign in is not available for this account.",
    rate_limited: "Too many sign-in requests. Try again later.",
  };
  const oidcError = query.get("oidc_error");
  const oidcHref = new URLSearchParams();
  const next = query.get("next");
  if (next) oidcHref.set("next", next);

  return (
    <AuthFrame
      title="Your wealth, in focus."
      description="Sign in to your private financial dashboard. Your data stays on this server."
      footer="Private, independent portfolios"
    >
      {config.localEnabled ? (
        <LoginForm
          authenticate={authenticate}
          onAuthenticated={onAuthenticated}
        />
      ) : null}
      {config.localEnabled && config.oidcEnabled ? (
        <div className="my-6 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-xs uppercase text-slate-500">or</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
      ) : null}
      {config.oidcEnabled ? (
        <div className={config.localEnabled ? "" : "mt-8"}>
          {oidcError ? (
            <p role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
              {(oidcErrors[oidcError] ?? oidcErrors.invalid_callback).replace(
                "Provider",
                config.providerName,
              )}
            </p>
          ) : null}
          <Button asChild className="w-full" variant={config.localEnabled ? "secondary" : "default"}>
            <a href={`/api/v1/auth/oidc/start${oidcHref.size ? `?${oidcHref}` : ""}`}>
              <LogIn size={17} />
              Continue with {config.providerName || "SSO"}
            </a>
          </Button>
        </div>
      ) : null}
    </AuthFrame>
  );
}

export function LoginForm({
  authenticate,
  onAuthenticated,
}: {
  authenticate: (input: LoginInput) => Promise<Session>;
  onAuthenticated: (session: Session) => void;
}) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = loginSchema.safeParse({
      username: data.get("username"),
      password: data.get("password"),
    });
    if (!result.success) {
      setFieldErrors(result.error.flatten().fieldErrors);
      return;
    }
    setFieldErrors({});
    setMessage("");
    setPending(true);
    try {
      onAuthenticated(await authenticate(result.data));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-8 space-y-5" noValidate>
      <div>
        <Label htmlFor="username">Username</Label>
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3 top-3.5 text-slate-500" size={17} />
          <Input id="username" name="username" autoComplete="username" className="pl-10" autoFocus aria-invalid={Boolean(fieldErrors.username)} />
        </div>
        <FieldError>{fieldErrors.username?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-3.5 text-slate-500" size={17} />
          <Input id="password" name="password" type="password" autoComplete="current-password" className="pl-10" aria-invalid={Boolean(fieldErrors.password)} />
        </div>
        <FieldError>{fieldErrors.password?.[0]}</FieldError>
      </div>
      {message ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{message}</p> : null}
      <Button className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" size={17} /> : null}
        Sign in
        {!pending ? <ArrowRight size={17} /> : null}
      </Button>
      <p className="text-center text-sm text-slate-400">
        New to Wealthboard? <Link to="/signup" className="font-medium text-emerald-300 hover:text-emerald-200">Create an account</Link>
      </p>
    </form>
  );
}

export function SignupScreen({
  authenticate,
  onAuthenticated,
}: {
  authenticate: (input: SignupInput) => Promise<Session>;
  onAuthenticated: (session: Session) => void;
}) {
  return (
    <AuthFrame
      title="Create your private portfolio."
      description="Your accounts, categories, and reports stay independent from every other user."
      footer="Local authentication with isolated financial data"
    >
      <SignupForm authenticate={authenticate} onAuthenticated={onAuthenticated} />
    </AuthFrame>
  );
}

export function SignupForm({
  authenticate,
  onAuthenticated,
}: {
  authenticate: (input: SignupInput) => Promise<Session>;
  onAuthenticated: (session: Session) => void;
}) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [values, setValues] = useState({
    username: "",
    displayName: "",
    baseCurrency: DEFAULT_BASE_CURRENCY,
    password: "",
    confirmPassword: "",
  });
  const updateValue = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.currentTarget;
    setValues((current) => ({ ...current, [name]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = signupSchema.safeParse(values);
    if (!result.success) {
      setFieldErrors(result.error.flatten().fieldErrors);
      return;
    }
    setFieldErrors({});
    setMessage("");
    setPending(true);
    try {
      onAuthenticated(await authenticate(result.data));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account creation failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-8 space-y-5" noValidate>
      <div>
        <Label htmlFor="signup-username">Username</Label>
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3 top-3.5 text-slate-500" size={17} />
          <Input id="signup-username" name="username" autoComplete="username" className="pl-10" autoFocus value={values.username} onChange={updateValue} aria-invalid={Boolean(fieldErrors.username)} />
        </div>
        <FieldError>{fieldErrors.username?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" autoComplete="name" value={values.displayName} onChange={updateValue} aria-invalid={Boolean(fieldErrors.displayName)} />
        <FieldError>{fieldErrors.displayName?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="baseCurrency">Base currency</Label>
        <Select id="baseCurrency" name="baseCurrency" value={values.baseCurrency} onChange={(event) => setValues((current) => ({ ...current, baseCurrency: event.target.value }))} aria-invalid={Boolean(fieldErrors.baseCurrency)}>
          {CURRENCY_CATALOG.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} - {currency.name}</option>)}
        </Select>
        <FieldError>{fieldErrors.baseCurrency?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="signup-password">Password</Label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-3.5 text-slate-500" size={17} />
          <Input id="signup-password" name="password" type="password" autoComplete="new-password" className="pl-10" value={values.password} onChange={updateValue} aria-invalid={Boolean(fieldErrors.password)} />
        </div>
        <FieldError>{fieldErrors.password?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" value={values.confirmPassword} onChange={updateValue} aria-invalid={Boolean(fieldErrors.confirmPassword)} />
        <FieldError>{fieldErrors.confirmPassword?.[0]}</FieldError>
      </div>
      {message ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{message}</p> : null}
      <Button className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" size={17} /> : null}
        Create account
        {!pending ? <ArrowRight size={17} /> : null}
      </Button>
      <p className="text-center text-sm text-slate-400">
        Already registered? <Link to="/login" className="font-medium text-emerald-300 hover:text-emerald-200">Sign in</Link>
      </p>
    </form>
  );
}