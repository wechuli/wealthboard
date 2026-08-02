"use client";

import { useState, useTransition, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionState } from "@/lib/validation";

export function MutationButton({
  action,
  confirm,
  successMessage,
  children,
  ...props
}: ButtonProps & {
  action: () => Promise<ActionState | void>;
  confirm?: string;
  successMessage?: string;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  return (
    <>
      <Button
        type="button"
        data-financial-mutation="true"
        disabled={pending}
        {...props}
        onClick={() => {
          if (!navigator.onLine) {
            toast.error("Reconnect before making financial changes.");
            return;
          }
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            const result = await action();
            if (result?.message && !result.ok) {
              setMessage(result.message);
              toast.error(result.message);
            } else {
              setMessage(undefined);
              if (successMessage) toast.success(successMessage);
            }
          });
        }}
      >
        {pending ? <LoaderCircle className="animate-spin" size={16} /> : children}
      </Button>
      {message ? <span className="sr-only" role="alert">{message}</span> : null}
    </>
  );
}
