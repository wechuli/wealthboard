import { zodResolver } from "@hookform/resolvers/zod";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { downloadExport, restoreUser } from "./api";
import type { Session } from "./types";
import { Card, CardHeader, humanize, KeyValue } from "./ui";

const restoreSchema = z.object({
  confirmation: z.literal("RESTORE"),
  file: z
    .instanceof(FileList)
    .refine((files) => files.length === 1, "Choose one JSON archive."),
});

export function PortabilityPanel({
  session,
  onChanged,
}: {
  session: Session;
  onChanged: () => void;
}) {
  const [summary, setSummary] = useState<Record<string, number>>();
  const [error, setError] = useState("");
  const form = useForm({
    resolver: zodResolver(restoreSchema),
    defaultValues: { confirmation: "" as "RESTORE" },
  });
  const submit = form.handleSubmit(async (values) => {
    if (
      !window.confirm(
        "Restore this archive and replace all of your current portfolio data?",
      )
    )
      return;
    setError("");
    try {
      const result = await restoreUser(values.file[0], session.csrfToken);
      setSummary(result);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The archive could not be restored.",
      );
    }
  });
  return (
    <Card>
      <CardHeader
        title="Data portability"
        description="Download owner-scoped exports or replace your data from a compatible JSON archive."
      />
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="page-actions">
        <button
          className="secondary-button"
          onClick={() =>
            void downloadExport("/exports/user", "wealthboard-export.json")
          }
        >
          <Download size={16} /> User JSON
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            void downloadExport(
              "/exports/accounts.csv",
              "wealthboard-accounts.csv",
            )
          }
        >
          <Download size={16} /> Accounts CSV
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            void downloadExport(
              "/exports/transactions.csv",
              "wealthboard-transactions.csv",
            )
          }
        >
          <Download size={16} /> Transactions CSV
        </button>
      </div>
      <form
        className="auth-form"
        data-financial-mutation="true"
        onSubmit={submit}
      >
        <div className="form-grid">
          <div>
            <label htmlFor="restore-file">JSON archive</label>
            <input
              id="restore-file"
              type="file"
              accept="application/json,.json"
              {...form.register("file")}
            />
          </div>
          <div>
            <label htmlFor="restore-confirmation">
              Type RESTORE to confirm replacement
            </label>
            <input
              id="restore-confirmation"
              autoComplete="off"
              {...form.register("confirmation")}
            />
          </div>
        </div>
        <button
          className="primary-button compact danger-button"
          disabled={form.formState.isSubmitting}
        >
          <Upload size={16} />
          {form.formState.isSubmitting ? "Restoring..." : "Restore archive"}
        </button>
      </form>
      {summary ? (
        <div className="notice" role="status">
          <strong>Restore complete</strong>
          <div className="key-grid">
            {Object.entries(summary).map(([label, count]) => (
              <KeyValue key={label} label={humanize(label)}>
                {count}
              </KeyValue>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
