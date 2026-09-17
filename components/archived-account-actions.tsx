"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArchiveRestore, LoaderCircle, Trash2, X } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { archiveAccountAction, deleteAccountAction } from "@/app/(app)/actions";
import { MutationButton } from "@/components/mutation-button";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form-controls";
import { deleteAccountSchema } from "@/lib/validation";

export function ArchivedAccountActions({
  accountId,
  name,
  canRestore,
}: {
  accountId: string;
  name: string;
  canRestore: boolean;
}) {
  const router = useRouter();
  const confirmationId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const form = useForm<z.infer<typeof deleteAccountSchema>>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { accountId, confirmationName: "" },
  });
  const confirmationName = useWatch({
    control: form.control,
    name: "confirmationName",
  });

  return (
    <div className="flex shrink-0 items-center gap-2">
      <MutationButton
        action={archiveAccountAction.bind(null, accountId, false)}
        confirm={`Restore ${name} and resume tracking its retained history?`}
        disabled={!canRestore}
        variant="secondary"
        size="sm"
        title={
          canRestore
            ? `Restore ${name}`
            : "Converted source accounts cannot be restored"
        }
      >
        <ArchiveRestore size={16} />
        Restore
      </MutationButton>
      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (pending) return;
          setOpen(nextOpen);
          form.reset({ accountId, confirmationName: "" });
          setMessage(undefined);
        }}
      >
        <Dialog.Trigger asChild>
          <Button
            variant="danger"
            size="icon"
            aria-label={`Delete ${name}`}
            title={`Delete ${name}`}
          >
            <Trash2 size={16} />
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-white/10 bg-[var(--panel-raised)] p-6 shadow-xl">
            <Dialog.Title className="pr-8 text-lg font-semibold text-slate-100">
              Permanently delete account
            </Dialog.Title>
            <Dialog.Description className="mt-3 break-words text-sm text-slate-400">
              {name} and its transactions, valuations, positions,
              reconciliations, and estate allocations will be permanently
              deleted. Linked goals remain without this account. This cannot be
              undone.
            </Dialog.Description>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2"
                aria-label="Close deletion dialog"
              >
                <X size={16} />
              </Button>
            </Dialog.Close>
            <form
              className="mt-5 space-y-4"
              onSubmit={form.handleSubmit((values) => {
                if (!navigator.onLine) {
                  setMessage("Reconnect before making financial changes.");
                  return;
                }
                startTransition(async () => {
                  const data = new FormData();
                  data.set("accountId", values.accountId);
                  data.set("confirmationName", values.confirmationName);
                  const result = await deleteAccountAction(data);
                  if (!result.ok) {
                    setMessage(
                      result.message || "The account could not be deleted.",
                    );
                    return;
                  }
                  setOpen(false);
                  router.refresh();
                });
              })}
            >
              <div>
                <Label htmlFor={confirmationId}>
                  Account name confirmation
                </Label>
                <Input
                  id={confirmationId}
                  autoComplete="off"
                  placeholder={name}
                  {...form.register("confirmationName")}
                />
                <FieldError>
                  {form.formState.errors.confirmationName?.message}
                </FieldError>
              </div>
              {message ? (
                <p role="alert" className="text-sm text-red-300">
                  {message}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary" disabled={pending}>
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  variant="danger"
                  disabled={pending || confirmationName !== name}
                >
                  {pending ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Permanently delete
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
