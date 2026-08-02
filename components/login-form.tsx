"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";

import { loginAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form-controls";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      <div>
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-3.5 text-slate-500" size={17} />
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="pl-10"
            autoFocus
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
        </div>
        <FieldError>{state.fieldErrors?.password?.[0]}</FieldError>
      </div>
      {state.message ? (
        <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
          {state.message}
        </p>
      ) : null}
      <Button className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" size={17} /> : null}
        Sign in
        {!pending ? <ArrowRight size={17} /> : null}
      </Button>
    </form>
  );
}
