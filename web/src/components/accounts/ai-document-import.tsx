import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  LoaderCircle,
  Send,
  X,
} from "lucide-react";

import { convertAIDocument, extractAIDocument, getAI } from "@/api/client";
import { usePrivacy } from "@/components/providers/privacy-provider";
import {
  Button,
  Checkbox,
  Input,
  Label,
  Textarea,
} from "@/components/ui/primitives";
import type {
  Account,
  AIConversionDraft,
  AIRead,
  AISource,
  Session,
} from "@/lib/types";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_PASSWORD_LENGTH = 1024;
const PAGE_SIZE = 10;

async function configurationHash(
  settings: NonNullable<AIRead["settings"]>,
  trackingMode: "balance" | "positions",
  currency: string,
) {
  const value = JSON.stringify([
    settings.provider,
    settings.baseUrl,
    settings.model,
    settings.maxOutputTokens,
    settings.updatedAt,
    trackingMode,
    currency,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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

export function AIDocumentImport({
  account,
  session,
  onPrepared,
}: {
  account: Account;
  session: Session;
  onPrepared: (file: File) => void;
}) {
  const { hidden } = usePrivacy();
  const fileInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [file, setFile] = useState<File | null>(null);
  const [documentPassword, setDocumentPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [source, setSource] = useState<AISource | null>(null);
  const [ai, setAI] = useState<AIRead | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [consent, setConsent] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"extract" | "convert" | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<AIConversionDraft | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (passwordRequired && !busy) passwordInput.current?.focus();
  }, [busy, passwordRequired]);

  function resetApproval() {
    setConsent(false);
    setDraft(null);
    setReviewed(false);
  }

  function clear() {
    if (fileInput.current) fileInput.current.value = "";
    setFile(null);
    setDocumentPassword("");
    setPasswordRequired(false);
    setSource(null);
    setAI(null);
    setSelected(new Set());
    setConsent(false);
    setApiKey("");
    setBusy(null);
    setDraft(null);
    setReviewed(false);
    setError("");
    setPage(0);
  }

  async function extract() {
    if (!file) return;
    if (!online) {
      setError("Reconnect before extracting a source document.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("Choose a source file no larger than 5 MB.");
      return;
    }
    setBusy("extract");
    setError("");
    const password = file.name.toLowerCase().endsWith(".pdf")
      ? documentPassword
      : "";
    setDocumentPassword("");
    try {
      const [result, aiRead] = await Promise.all([
        extractAIDocument(file, password, session.csrfToken),
        getAI(),
      ]);
      setSource(result.source);
      setAI(aiRead);
      setSelected(new Set(result.source.units.map((unit) => unit.id)));
      setFile(null);
      setPasswordRequired(false);
      resetApproval();
    } catch (caught) {
      const code =
        caught instanceof Error && "code" in caught ? caught.code : undefined;
      setPasswordRequired(
        code === "password_required" || code === "incorrect_password",
      );
      setError(caught instanceof Error ? caught.message : "Extraction failed.");
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    if (!source || !ai?.settings || !consent || !selected.size || !online)
      return;
    setBusy("convert");
    setError("");
    setDraft(null);
    try {
      const trackingMode =
        account.trackingMode === "positions" ? "positions" : "balance";
      const hash = await configurationHash(
        ai.settings,
        trackingMode,
        account.currency,
      );
      const result = await convertAIDocument(
        {
          source: {
            units: source.units.filter((unit) => selected.has(unit.id)),
            warnings: source.warnings,
          },
          configurationHash: hash,
          consent: true,
          trackingMode,
          currency: account.currency,
          ...(apiKey ? { apiKey } : {}),
        },
        session.csrfToken,
      );
      setDraft(result);
      setReviewed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversion failed.");
    } finally {
      setApiKey("");
      setConsent(false);
      setBusy(null);
    }
  }

  function prepareDraft() {
    if (!draft || !reviewed) return;
    try {
      JSON.parse(draft.content);
      onPrepared(
        new File([draft.content], "wealthboard-import-draft.json", {
          type: "application/json",
        }),
      );
      setError("");
    } catch {
      setError("The draft must be valid JSON before preview.");
    }
  }

  if (hidden) {
    return (
      <p role="status" className="text-sm text-slate-400">
        Financial content hidden. Reveal financial values to convert a source
        document.
      </p>
    );
  }

  const settings = ai?.settings;
  const pageCount = Math.ceil((source?.units.length ?? 0) / PAGE_SIZE);
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            Source file conversion
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Extract, redact, and approve source text before sending it to your
            configured AI provider.
          </p>
        </div>
        {(file || source || busy) && (
          <Button type="button" variant="secondary" onClick={clear}>
            <X size={16} /> Cancel
          </Button>
        )}
      </div>

      {!online ? (
        <div className="notice warning" role="status">
          Offline. Extraction and AI conversion require a connection.
        </div>
      ) : null}

      {!source ? (
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
          {file?.name.toLowerCase().endsWith(".pdf") ? (
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
                maxLength={MAX_PASSWORD_LENGTH}
                value={documentPassword}
                disabled={busy !== null}
                aria-invalid={passwordRequired || undefined}
                onChange={(event) => setDocumentPassword(event.target.value)}
              />
              <p className="mt-1 text-xs text-slate-400">
                Used only for this extraction attempt. It is cleared after use
                and is never sent to the AI provider.
              </p>
            </div>
          ) : null}
          <p className="text-xs text-slate-400">
            TXT, CSV, TSV, JSON, PDF, XLSX, or DOCX. Maximum 5 MB. Scanned
            documents and images are unsupported.
          </p>
          <Button
            type="button"
            onClick={() => void extract()}
            disabled={!file || busy !== null || !online}
          >
            {busy === "extract" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <FileText size={16} />
            )}
            Extract source
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-4 border-t border-white/10 pt-4">
            <h3 className="text-sm font-semibold text-slate-200">
              Extracted source units
            </h3>
            {source.warnings.map((warning, index) => (
              <p key={index} className="text-sm text-amber-300">
                {warning}
              </p>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Checkbox
                label={`Include all ${source.units.length} units`}
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
                  resetApproval();
                }}
              />
              <span className="text-xs text-slate-400">
                {selected.size} selected; {source.units.length - selected.size}{" "}
                excluded
              </span>
            </div>
            {source.units
              .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
              .map((unit) => (
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
                      resetApproval();
                    }}
                  />
                  <Label htmlFor={`approved-${unit.id}`}>
                    Approved text for {unit.id}
                  </Label>
                  <Textarea
                    id={`approved-${unit.id}`}
                    value={unit.text}
                    disabled={busy !== null || !selected.has(unit.id)}
                    className="font-mono text-xs"
                    onChange={(event) => {
                      setSource({
                        ...source,
                        units: source.units.map((current) =>
                          current.id === unit.id
                            ? { ...current, text: event.target.value }
                            : current,
                        ),
                      });
                      resetApproval();
                    }}
                  />
                </div>
              ))}
            {pageCount > 1 ? (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Previous source units"
                  disabled={page === 0}
                  onClick={() => setPage((current) => current - 1)}
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
                  aria-label="Next source units"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((current) => current + 1)}
                >
                  <ArrowRight size={16} />
                </Button>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 border-t border-white/10 pt-4">
            {settings ? (
              <>
                <p className="break-words text-sm text-slate-300">
                  Destination: {settings.provider} / {settings.baseUrl} /{" "}
                  {settings.model}
                </p>
                <p className="text-xs text-slate-400">
                  Account context: {account.trackingMode}, {account.currency}.
                  Only selected, edited text is sent; the original file and
                  section locations are not sent.
                </p>
                {!settings.hasStoredApiKey ? (
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
                ) : null}
                <Checkbox
                  label="I approve sending the selected text and account context, and acknowledge excluded or unreadable content and possible provider charges."
                  checked={consent}
                  disabled={busy !== null}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <Button
                  type="button"
                  onClick={() => void convert()}
                  disabled={
                    !online ||
                    !consent ||
                    !selected.size ||
                    busy !== null ||
                    (!settings.hasStoredApiKey && apiKey.length < 8)
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
                No AI provider is configured. Configure one in Settings before
                converting this source.
              </p>
            )}
          </div>
        </>
      )}

      {draft ? (
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
              Evidence references and exclusions
            </summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto break-words">
              {draft.references.map((reference, index) => (
                <li key={`reference-${index}`}>
                  {reference.collection} row {reference.row}:{" "}
                  {reference.sourceIds.join(", ")}
                </li>
              ))}
              {draft.exclusions.map((exclusion, index) => (
                <li key={`exclusion-${index}`}>
                  Excluded {exclusion.sourceId}: {exclusion.reason}
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
            className="font-mono text-xs"
            onChange={(event) => {
              setDraft({ ...draft, content: event.target.value });
              setReviewed(false);
            }}
          />
          <Checkbox
            label="I reviewed the source coverage, resolved any issues in the draft, and acknowledge all excluded activity."
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={prepareDraft} disabled={!reviewed}>
              <ArrowRight size={16} /> Use draft for preview
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => downloadDraft(draft.content)}
            >
              <Download size={16} /> Download draft
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
