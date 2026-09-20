import { LoaderCircle, Save } from "lucide-react";
import { useRef, useState, useTransition, type ReactNode } from "react";

import { Button, cn } from "./estate-ui";

export type EstateActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type EstateFormAction = (
  formData: FormData,
) => Promise<EstateActionState>;

export function actionError(error: unknown): EstateActionState {
  return {
    ok: false,
    message:
      error instanceof Error
        ? error.message
        : "The estate plan could not be changed.",
  };
}

export function EstateManagedForm({
  action,
  children,
  submitLabel,
  resetOnSuccess = false,
  className,
}: {
  action: EstateFormAction;
  children: (state: EstateActionState) => ReactNode;
  submitLabel: string;
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<EstateActionState>({});

  return (
    <form
      ref={formRef}
      className={cn("grid gap-4", className)}
      data-financial-mutation="true"
      onSubmit={(event) => {
        event.preventDefault();
        if (!navigator.onLine) {
          setState({
            ok: false,
            message: "Reconnect before changing your estate plan.",
          });
          return;
        }
        startTransition(async () => {
          const result = await action(new FormData(formRef.current!));
          setState(result);
          if (result.ok && resetOnSuccess) formRef.current?.reset();
        });
      }}
    >
      {children(state)}
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok ? "text-sm text-slate-400" : "text-sm text-red-300"
          }
        >
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <Save size={15} />
          )}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
