"use client";

import {
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/validation";
import { cn } from "@/lib/utils";

export function EstateManagedForm({
  action,
  children,
  submitLabel,
  resetOnSuccess = false,
  className,
}: {
  action: (formData: FormData) => Promise<ActionState>;
  children: (state: ActionState) => ReactNode;
  submitLabel: string;
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>({});

  return (
    <form
      ref={formRef}
      className={cn("grid gap-4", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!navigator.onLine) {
          toast.error("Reconnect before changing your estate plan.");
          return;
        }
        startTransition(async () => {
          const result = await action(new FormData(formRef.current!));
          setState(result);
          if (result.ok) {
            toast.success(result.message);
            if (resetOnSuccess) formRef.current?.reset();
            router.refresh();
          } else if (result.message) {
            toast.error(result.message);
          }
        });
      }}
    >
      {children(state)}
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "text-sm text-slate-400" : "text-sm text-red-300"}
        >
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}