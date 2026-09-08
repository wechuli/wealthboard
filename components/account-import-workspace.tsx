"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  LoaderCircle,
  Send,
  X,
} from "lucide-react";

import { AccountHistoryImport } from "@/components/account-history-import";
import { InvestmentHistoryImport } from "@/components/investment-history-import";
import { usePrivacy } from "@/components/privacy-provider";
import { Button } from "@/components/ui/button";
import {
  Checkbox,
  Input,
  Label,
  Textarea,
} from "@/components/ui/form-controls";
import {
  IMPORT_DOCUMENT_PASSWORD_MAX_LENGTH,
  IMPORT_SOURCE_MAX_BYTES,
  type ImportConversionResult,
  type ImportProviderView,
  type ImportSource,
} from "@/lib/ai/import-schemas";

export function AccountImportWorkspace({
  accountId,
  trackingMode,
  currency,
  children,
}: {
  accountId: string;
  trackingMode: string;
  currency: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState("structured");
  const [locked, setLocked] = useState(false);
  return (
    <section className="min-w-0 space-y-5">
      <fieldset
        aria-label="Import method"
        className="flex flex-wrap gap-4 border-b border-white/10 pb-4"
      >
        {[
          { value: "structured", label: "Formatted CSV / JSON" },
          { value: "ai", label: "Convert with AI" },
        ].map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 items-center gap-2 text-sm text-slate-200"
          >
            <input
              type="radio"
              name="importMethod"
              value={option.value}
              checked={mode === option.value}
              disabled={locked}
              onChange={() => setMode(option.value)}
              className="accent-emerald-400"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {mode === "structured" ? (
        children
      ) : (
        <AiSourceImport
          key={accountId}
          accountId={accountId}
          trackingMode={trackingMode}
          currency={currency}
          onLockChange={setLocked}
        />
      )}
    </section>
  );
}

function downloadDraft(content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "wealthboard-import-draft.json";
  link.click();
  URL.revokeObjectURL(url);
}

function AiSourceImport({
  accountId,
  trackingMode,
  currency,
  onLockChange,
}: {
  accountId: string;
  trackingMode: string;
  currency: string;
  onLockChange: (locked: boolean) => void;
}) {
  const { hidden } = usePrivacy();
  const activeRequest = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const passwordInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentPassword, setDocumentPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [provider, setProvider] = useState<ImportProviderView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [consent, setConsent] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"extract" | "convert" | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ImportConversionResult | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [preparedFile, setPreparedFile] = useState<File | null>(null);
  const [page, setPage] = useState(0);
  const [complete, setComplete] = useState(false);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (passwordRequired && !busy) passwordInput.current?.focus();
  }, [passwordRequired, busy]);

  function clear() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    if (fileInput.current) fileInput.current.value = "";
    setFile(null);
    setDocumentPassword("");
    setPasswordRequired(false);
    setSource(null);
    setProvider(null);
    setSelected(new Set());
    setConsent(false);
    setApiKey("");
    setBusy(null);
    setDraft(null);
    setPreparedFile(null);
    setReviewed(false);
    setError("");
    setPage(0);
    onLockChange(false);
  }

  async function extract() {
    if (!file) return;
    if (file.size > IMPORT_SOURCE_MAX_BYTES)
      return setError("Choose a source file no larger than 5 MB.");
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy("extract");
    setError("");
    setComplete(false);
    const body = new FormData();
    body.set("file", file);
    if (file.name.toLowerCase().endsWith(".pdf") && documentPassword) {
      body.set("documentPassword", documentPassword);
    }
    setDocumentPassword("");
    try {
      const response = await fetch(
        `/api/accounts/${accountId}/import/extract`,
        { method: "POST", body, signal: controller.signal },
      );
      const result = (await response.json()) as {
        source: ImportSource;
        provider: ImportProviderView | null;
        error?: string;
        code?: string;
      };
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setPasswordRequired(
          result.code === "password_required" ||
            result.code === "incorrect_password",
        );
        throw new Error(result.error || "Extraction failed.");
      }
      setSource(result.source);
      setProvider(result.provider);
      setSelected(new Set(result.source.units.map((unit) => unit.id)));
      setFile(null);
      setPasswordRequired(false);
      setConsent(false);
      setDraft(null);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Extraction failed.");
    } finally {
      body.delete("documentPassword");
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function convert() {
    if (!source || !provider || !consent) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy("convert");
    setError("");
    setDraft(null);
    try {
      const response = await fetch(
        `/api/accounts/${accountId}/import/convert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            source: {
              units: source.units.filter((unit) => selected.has(unit.id)),
              warnings: source.warnings,
            },
            configurationHash: provider.configurationHash,
            consent: true,
            ...(apiKey ? { apiKey } : {}),
          }),
        },
      );
      const result = (await response.json()) as ImportConversionResult & {
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Conversion failed.");
      if (controller.signal.aborted) return;
      setDraft(result);
      setReviewed(false);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Conversion failed.");
    } finally {
      if (!controller.signal.aborted) {
        setBusy(null);
        setApiKey("");
        setConsent(false);
      }
    }
  }

  function prepareDraft() {
    if (!draft || !reviewed) return;
    try {
      JSON.parse(draft.content);
      setPreparedFile(
        new File([draft.content], "wealthboard-import-draft.json", {
          type: "application/json",
        }),
      );
      onLockChange(true);
      setError("");
    } catch {
      setError("The draft must be valid JSON before preview.");
    }
  }

  if (hidden)
    return (
      <p role="status" className="text-sm text-slate-400">
        Financial content hidden.
      </p>
    );

  if (preparedFile) {
    const props = {
      accountId,
      initialFile: preparedFile,
      onEditFile: () => {
        setPreparedFile(null);
        setReviewed(false);
        onLockChange(false);
      },
      onComplete: () => {
        clear();
        setComplete(true);
      },
    };
    return trackingMode === "positions" ? (
      <InvestmentHistoryImport {...props} />
    ) : (
      <AccountHistoryImport {...props} />
    );
  }

  const pageCount = Math.ceil((source?.units.length ?? 0) / 10);
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">
          Source file conversion
        </h2>
        {(file || source || busy) && (
          <Button type="button" variant="secondary" onClick={clear}>
            <X size={16} />
            Cancel
          </Button>
        )}
      </div>
      {complete && (
        <p role="status" className="text-sm text-emerald-300">
          Import complete.{" "}
          <Link href={`/accounts/${accountId}`} className="underline">
            View account
          </Link>
        </p>
      )}
      {!source && (
        <div className="space-y-3">
          <Label htmlFor="importSourceFile">Source file</Label>
          <Input
            ref={fileInput}
            id="importSourceFile"
            type="file"
            accept=".csv,.tsv,.json,.txt,.xlsx,.pdf,.docx"
            disabled={busy !== null}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setDocumentPassword("");
              setPasswordRequired(false);
              setError("");
            }}
          />
          {file?.name.toLowerCase().endsWith(".pdf") && (
            <div>
              <Label htmlFor="importDocumentPassword">
                PDF password (if required)
              </Label>
              <Input
                ref={passwordInput}
                id="importDocumentPassword"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={IMPORT_DOCUMENT_PASSWORD_MAX_LENGTH}
                value={documentPassword}
                disabled={busy !== null}
                aria-invalid={passwordRequired || undefined}
                aria-describedby={
                  passwordRequired
                    ? "importPasswordPrivacy importPreparationError"
                    : "importPasswordPrivacy"
                }
                onChange={(event) => setDocumentPassword(event.target.value)}
              />
              <p
                id="importPasswordPrivacy"
                className="mt-1 text-xs text-slate-400"
              >
                Used only to unlock this PDF on your Wealthboard server. Never
                saved or sent to the AI provider; cleared after each attempt.
              </p>
              {passwordRequired && error && (
                <p
                  id="importPreparationError"
                  role="alert"
                  className="mt-2 text-sm text-red-300"
                >
                  {error}
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-slate-400">
            CSV, TSV, JSON, TXT, XLSX, text-based PDF, or DOCX. Maximum 5 MB;
            extracted content: 64 KB and 1,000 sections. Scanned documents and
            images are unsupported.
          </p>
          <Button
            type="button"
            onClick={extract}
            disabled={!file || busy !== null}
          >
            {busy === "extract" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <FileText size={16} />
            )}
            Extract locally
          </Button>
        </div>
      )}
      {source && (
        <>
          <div className="space-y-4 border-t border-white/10 pt-4">
            <h3 className="text-sm font-semibold text-slate-200">
              Source review
            </h3>
            {source.warnings.map((warning, index) => (
              <p key={index} className="text-sm text-amber-300">
                {warning}
              </p>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Checkbox
                label={`Include all ${source.units.length} sections`}
                checked={selected.size === source.units.length}
                disabled={busy !== null}
                onChange={(event) => {
                  setSelected(
                    new Set(
                      event.target.checked
                        ? source.units.map((unit) => unit.id)
                        : [],
                    ),
                  );
                  setConsent(false);
                  setDraft(null);
                }}
              />
              <span className="text-xs text-slate-400">
                {selected.size} selected; {source.units.length - selected.size}{" "}
                excluded
              </span>
            </div>
            {source.units.slice(page * 10, (page + 1) * 10).map((unit) => (
              <div
                key={unit.id}
                className="min-w-0 space-y-1 border-b border-white/10 pb-3"
              >
                <Checkbox
                  label={`${unit.id}: ${unit.location}`}
                  checked={selected.has(unit.id)}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(unit.id);
                      else next.delete(unit.id);
                      return next;
                    });
                    setConsent(false);
                    setDraft(null);
                  }}
                />
                <Label htmlFor={unit.id}>Approved text for {unit.id}</Label>
                <Textarea
                  id={unit.id}
                  value={unit.text}
                  disabled={busy !== null || !selected.has(unit.id)}
                  onChange={(event) => {
                    setSource({
                      ...source,
                      units: source.units.map((current) =>
                        current.id === unit.id
                          ? { ...current, text: event.target.value }
                          : current,
                      ),
                    });
                    setConsent(false);
                    setDraft(null);
                  }}
                  className="font-mono text-xs"
                />
              </div>
            ))}
            {pageCount > 1 && (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Previous source sections"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ArrowLeft size={16} />
                </Button>
                <span className="text-xs text-slate-400">
                  {page + 1} / {pageCount}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Next source sections"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  <ArrowRight size={16} />
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-3 border-t border-white/10 pt-4">
            {provider ? (
              <>
                <p className="break-words text-sm text-slate-300">
                  Destination: {provider.provider} / {provider.host} /{" "}
                  {provider.model}
                </p>
                <p className="text-xs text-slate-400">
                  Account context:{" "}
                  {trackingMode === "positions"
                    ? "Investment History v1"
                    : "Account History v1"}
                  , {currency}, currency precision, and enabled currencies. Only
                  selected text is sent; original files are not sent to the
                  provider.
                </p>
                <p className="text-xs text-slate-400">
                  {new TextEncoder()
                    .encode(
                      JSON.stringify(
                        source.units.filter((unit) => selected.has(unit.id)),
                      ),
                    )
                    .length.toLocaleString()}{" "}
                  bytes of source text, plus schema/context; output ceiling:{" "}
                  {provider.maxOutputTokens.toLocaleString()} tokens. Provider
                  charges may apply. Monthly token limits are enforced before
                  submission.
                </p>
                {!provider.hasStoredApiKey && (
                  <div>
                    <Label htmlFor="importSessionKey">
                      Session-only API key
                    </Label>
                    <Input
                      id="importSessionKey"
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      disabled={busy !== null}
                      onChange={(event) => {
                        setApiKey(event.target.value);
                        setConsent(false);
                      }}
                    />
                  </div>
                )}
                <p className="text-xs text-slate-400">
                  Wealthboard does not retain source content or drafts. Section
                  labels and original filenames are not sent. The
                  provider&apos;s own retention policy applies.
                </p>
                <Checkbox
                  label="I approve sending the selected text and account context, and acknowledge excluded or unreadable content and possible provider charges."
                  checked={consent}
                  disabled={busy !== null}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <Button
                  type="button"
                  onClick={convert}
                  disabled={
                    !consent ||
                    !selected.size ||
                    busy !== null ||
                    (!provider.hasStoredApiKey && apiKey.length < 8)
                  }
                >
                  {busy === "convert" ? (
                    <LoaderCircle className="animate-spin" size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                  Convert selected text
                </Button>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                No AI provider is configured.{" "}
                <Link href="/settings" className="underline">
                  Open AI settings
                </Link>
              </p>
            )}
          </div>
        </>
      )}
      {draft && (
        <div className="space-y-4 border-t border-white/10 pt-4">
          <h3 className="text-sm font-semibold text-slate-200">
            Conversion draft
          </h3>
          {draft.issues.map((issue, index) => (
            <p key={index} className="text-sm text-amber-300">
              {issue}
            </p>
          ))}
          <details className="text-sm text-slate-400">
            <summary className="cursor-pointer">
              Source references and exclusions
            </summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto break-words">
              {draft.references.map((reference, index) => (
                <li key={`record-${index}`}>
                  {reference.collection} row {reference.row}:{" "}
                  {reference.sourceIds.join(", ")}
                </li>
              ))}
              {draft.exclusions.map((excluded, index) => (
                <li key={`excluded-${index}`}>
                  Excluded {excluded.sourceId}: {excluded.reason}
                </li>
              ))}
            </ul>
          </details>
          <Label htmlFor="importDraft">Canonical JSON draft</Label>
          <Textarea
            id="importDraft"
            value={draft.content}
            rows={14}
            spellCheck={false}
            onChange={(event) => {
              setDraft({ ...draft, content: event.target.value });
              setReviewed(false);
            }}
            className="font-mono text-xs"
          />
          <Checkbox
            label="I reviewed the source coverage, resolved any issues in the draft, and acknowledge all excluded activity."
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={prepareDraft} disabled={!reviewed}>
              <ArrowRight size={16} />
              Use draft for preview
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => downloadDraft(draft.content)}
            >
              <Download size={16} />
              Download draft
            </Button>
          </div>
        </div>
      )}
      {error && !passwordRequired && (
        <p
          id="importPreparationError"
          role="alert"
          className="text-sm text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
