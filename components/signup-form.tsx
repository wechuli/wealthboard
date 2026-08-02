"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, KeyRound, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";

import { signupAction } from "@/app/signup/actions";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form-controls";

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, {});

  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      <div>
        <Label htmlFor="username">Username</Label>
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3 top-3.5 text-slate-500" size={17} />
          <Input
            id="username"
            name="username"
            autoComplete="username"
            className="pl-10"
            autoFocus
            aria-invalid={Boolean(state.fieldErrors?.username)}
          />
        </div>
        <FieldError>{state.fieldErrors?.username?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="name"
          aria-invalid={Boolean(state.fieldErrors?.displayName)}
        />
        <FieldError>{state.fieldErrors?.displayName?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-3.5 text-slate-500" size={17} />
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            className="pl-10"
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
        </div>
        <FieldError>{state.fieldErrors?.password?.[0]}</FieldError>
      </div>
      <div>
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
        />
        <FieldError>{state.fieldErrors?.confirmPassword?.[0]}</FieldError>
      </div>
      <details className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-300">
          Claim an older Worthboard portfolio
        </summary>
        <div className="mt-4">
          <Label htmlFor="legacyPassword">Previous Worthboard password</Label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-3.5 text-slate-500" size={17} />
            <Input
              id="legacyPassword"
              name="legacyPassword"
              type="password"
              autoComplete="current-password"
              className="pl-10"
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Use this only when upgrading an existing single-user installation.
          </p>
        </div>
      </details>
      {state.message ? (
        <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
          {state.message}
        </p>
      ) : null}
      <Button className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" size={17} /> : null}
        Create account
        {!pending ? <ArrowRight size={17} /> : null}
      </Button>
      <p className="text-center text-sm text-slate-400">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-emerald-300 hover:text-emerald-200">
          Sign in
        </Link>
      </p>
    </form>
  );
}
