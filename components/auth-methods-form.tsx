"use client";

import { useActionState } from "react";
import {
  KeyRound,
  Link2,
  Link2Off,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";

import {
  enableLocalCredentialAction,
  removeLocalCredentialAction,
  startOidcLinkAction,
  startOidcReauthenticationAction,
  unlinkOidcIdentityAction,
} from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/form-controls";

function ActionMessage({
  state,
}: {
  state: { ok?: boolean; message?: string };
}) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={state.ok ? "text-sm text-emerald-300" : "text-sm text-red-300"}
    >
      {state.message}
    </p>
  );
}

function SubmitLabel({
  pending,
  icon,
  children,
}: {
  pending: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      {pending ? (
        <LoaderCircle
          className="animate-spin motion-reduce:animate-none"
          size={16}
        />
      ) : (
        icon
      )}
      {children}
    </>
  );
}

export function AuthenticationMethodsForm({
  localEnabled,
  oidcEnabled,
  providerName,
  hasPassword,
  oidcLinked,
  reauthenticated,
  feedback,
}: {
  localEnabled: boolean;
  oidcEnabled: boolean;
  providerName?: string;
  hasPassword: boolean;
  oidcLinked: boolean;
  reauthenticated: boolean;
  feedback?: string;
}) {
  const [linkState, linkAction, linkPending] = useActionState(
    startOidcLinkAction,
    {},
  );
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(
    unlinkOidcIdentityAction,
    {},
  );
  const [reauthState, reauthAction, reauthPending] = useActionState(
    startOidcReauthenticationAction,
    {},
  );
  const [enableState, enableAction, enablePending] = useActionState(
    enableLocalCredentialAction,
    {},
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeLocalCredentialAction,
    {},
  );
  const hybrid = localEnabled && oidcEnabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentication methods</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {feedback ? (
          <p
            role="alert"
            className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"
          >
            {feedback}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-h-20 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
            <KeyRound className="text-emerald-300" size={20} />
            <div>
              <p className="text-sm font-medium text-slate-100">
                Local password
              </p>
              <p className="text-xs text-slate-400">
                {localEnabled
                  ? hasPassword
                    ? "Enabled"
                    : "Not enabled"
                  : "Disabled by deployment policy"}
              </p>
            </div>
          </div>
          <div className="flex min-h-20 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
            <ShieldCheck className="text-emerald-300" size={20} />
            <div>
              <p className="text-sm font-medium text-slate-100">
                {providerName ?? "OIDC provider"}
              </p>
              <p className="text-xs text-slate-400">
                {oidcEnabled
                  ? oidcLinked
                    ? "Linked"
                    : "Not linked"
                  : "Disabled by deployment policy"}
              </p>
            </div>
          </div>
        </div>

        {hybrid && hasPassword && !oidcLinked ? (
          <form action={linkAction} className="space-y-3">
            <p className="text-sm text-slate-300">
              Confirm your current password, then continue through{" "}
              {providerName}
              to link the identity explicitly.
            </p>
            <div className="max-w-sm">
              <Label htmlFor="linkCurrentPassword">Current password</Label>
              <Input
                id="linkCurrentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
              />
              <FieldError>
                {linkState.fieldErrors?.currentPassword?.[0]}
              </FieldError>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={linkPending}>
                <SubmitLabel pending={linkPending} icon={<Link2 size={16} />}>
                  Link {providerName}
                </SubmitLabel>
              </Button>
              <ActionMessage state={linkState} />
            </div>
          </form>
        ) : null}

        {hybrid && hasPassword && oidcLinked ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <form action={unlinkAction} className="space-y-3">
              <p className="text-sm text-slate-300">
                Unlink provider sign-in after confirming your local password.
              </p>
              <div>
                <Label htmlFor="unlinkCurrentPassword">Current password</Label>
                <Input
                  id="unlinkCurrentPassword"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                />
                <FieldError>
                  {unlinkState.fieldErrors?.currentPassword?.[0]}
                </FieldError>
              </div>
              <Button variant="outline" disabled={unlinkPending}>
                <SubmitLabel
                  pending={unlinkPending}
                  icon={<Link2Off size={16} />}
                >
                  Unlink {providerName}
                </SubmitLabel>
              </Button>
              <ActionMessage state={unlinkState} />
            </form>

            <form action={reauthAction} className="space-y-3">
              <p className="text-sm text-slate-300">
                Removing local sign-in requires a fresh verification with{" "}
                {providerName}.
              </p>
              <Button variant="outline" disabled={reauthPending}>
                <SubmitLabel
                  pending={reauthPending}
                  icon={<ShieldCheck size={16} />}
                >
                  Verify with {providerName}
                </SubmitLabel>
              </Button>
              <ActionMessage state={reauthState} />
            </form>
          </div>
        ) : null}

        {hybrid && !hasPassword && oidcLinked ? (
          <div className="space-y-4">
            {!reauthenticated ? (
              <form action={reauthAction} className="space-y-3">
                <p className="text-sm text-slate-300">
                  Verify with {providerName} before creating a local username
                  and password.
                </p>
                <Button variant="outline" disabled={reauthPending}>
                  <SubmitLabel
                    pending={reauthPending}
                    icon={<ShieldCheck size={16} />}
                  >
                    Verify with {providerName}
                  </SubmitLabel>
                </Button>
                <ActionMessage state={reauthState} />
              </form>
            ) : (
              <form action={enableAction} className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <p className="text-sm text-emerald-300">
                    Provider verification complete. This authorization expires
                    shortly.
                  </p>
                </div>
                <div>
                  <Label htmlFor="localUsername">Local username</Label>
                  <Input
                    id="localUsername"
                    name="username"
                    autoComplete="username"
                  />
                  <FieldError>
                    {enableState.fieldErrors?.username?.[0]}
                  </FieldError>
                </div>
                <div>
                  <Label htmlFor="localPassword">Password</Label>
                  <Input
                    id="localPassword"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                  />
                  <FieldError>
                    {enableState.fieldErrors?.password?.[0]}
                  </FieldError>
                </div>
                <div>
                  <Label htmlFor="localConfirmPassword">Confirm password</Label>
                  <Input
                    id="localConfirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                  />
                  <FieldError>
                    {enableState.fieldErrors?.confirmPassword?.[0]}
                  </FieldError>
                </div>
                <div className="flex items-end">
                  <Button disabled={enablePending}>
                    <SubmitLabel
                      pending={enablePending}
                      icon={<KeyRound size={16} />}
                    >
                      Enable local sign-in
                    </SubmitLabel>
                  </Button>
                </div>
                <div className="sm:col-span-2">
                  <ActionMessage state={enableState} />
                </div>
              </form>
            )}
          </div>
        ) : null}

        {hybrid && hasPassword && oidcLinked && reauthenticated ? (
          <form
            action={removeAction}
            className="space-y-3 border-t border-white/[0.07] pt-5"
          >
            <p className="text-sm text-emerald-300">
              Provider verification complete. Removing local sign-in leaves{" "}
              {providerName}
              as your usable method.
            </p>
            <Button variant="danger" disabled={removePending}>
              <SubmitLabel
                pending={removePending}
                icon={<KeyRound size={16} />}
              >
                Remove local sign-in
              </SubmitLabel>
            </Button>
            <ActionMessage state={removeState} />
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
