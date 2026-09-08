import "server-only";

import { ZodError } from "zod";

import {
  IMPORT_SOURCE_MAX_BYTES,
  IMPORT_TEXT_MAX_BYTES,
  importDocumentPasswordSchema,
  type ImportSourceErrorCode,
} from "@/lib/ai/import-schemas";
import {
  AiImportResponseError,
  AiProviderAuthenticationError,
  AiProviderCancelledError,
  AiProviderRateLimitError,
  AiProviderTimeoutError,
  AiProviderUnavailableError,
} from "@/lib/ai/provider";
import { requireTrustedOrigin } from "@/lib/auth/origin";
import { getSession } from "@/lib/auth/session";
import {
  AiCredentialRequiredError,
  AiProviderNotConfiguredError,
  AiReviewBudgetError,
  AiReviewRateLimitError,
} from "@/lib/services/ai-provider";
import {
  convertImportSource,
  getImportProvider,
  ImportAccountAccessError,
  ImportConversionError,
  requireImportAccount,
} from "@/lib/services/import-conversion";
import {
  extractImportSource,
  ImportSourceError,
} from "@/lib/services/import-source";

const activeUsers = new Set<string>();
const headers = { "Cache-Control": "no-store" };
const responseError = (
  error: string,
  status: number,
  code?: ImportSourceErrorCode,
) => Response.json({ error, ...(code ? { code } : {}) }, { status, headers });

async function boundedBody(request: Request, maximum: number) {
  if (Number(request.headers.get("content-length")) > maximum)
    throw new ImportSourceError("The request exceeds the upload limit.");
  const reader = request.body?.getReader();
  if (!reader) throw new ImportSourceError("The request is empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, 15_000);
  try {
    while (true) {
      const result = await reader.read();
      if (timedOut || request.signal.aborted)
        throw new ImportSourceError("Upload timed out or was cancelled.");
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new ImportSourceError("The request exceeds the upload limit.");
      }
      chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export async function handleImportPreparation(
  request: Request,
  params: Promise<{ id: string }>,
  phase: "extract" | "convert",
) {
  const session = await getSession();
  if (!session) return responseError("Authentication required.", 401);
  try {
    requireTrustedOrigin(request);
  } catch {
    return responseError("The request origin is not trusted.", 403);
  }
  let acquired = false;
  try {
    const { id } = await params;
    await requireImportAccount(session.userId, id);
    if (activeUsers.has(session.userId) || activeUsers.size >= 4)
      return responseError(
        "An import preparation is already running. Try again after it completes.",
        429,
      );
    activeUsers.add(session.userId);
    acquired = true;
    if (phase === "extract") {
      const body = await boundedBody(
        request,
        IMPORT_SOURCE_MAX_BYTES + 32 * 1024,
      );
      const form = await new Response(body, {
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File))
        return responseError("Choose a source file.", 400);
      const passwords = form.getAll("documentPassword");
      const password = importDocumentPasswordSchema.safeParse(passwords[0]);
      if (passwords.length > 1 || !password.success) {
        return responseError(
          "Provide one document password of at most 1,024 characters.",
          400,
        );
      }
      const source = await extractImportSource(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        request.signal,
        password.data,
      );
      const provider = await getImportProvider(session.userId, id);
      return Response.json({ source, provider }, { headers });
    }
    const body = await boundedBody(request, IMPORT_TEXT_MAX_BYTES + 8 * 1024);
    const result = await convertImportSource(
      session.userId,
      id,
      JSON.parse(body.toString("utf8")),
      { signal: request.signal },
    );
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ImportAccountAccessError)
      return responseError("Account not found.", 404);
    if (
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    )
      return responseError(
        "Check the source file, selected content, and sharing consent.",
        400,
      );
    if (
      error instanceof AiReviewBudgetError ||
      error instanceof AiReviewRateLimitError
    )
      return responseError(error.message, 429);
    if (error instanceof AiProviderAuthenticationError)
      return responseError(
        "The provider rejected the API key. Update AI settings or enter a session-only key.",
        502,
      );
    if (error instanceof AiProviderTimeoutError)
      return responseError(
        "The provider timed out. Try a smaller source file.",
        504,
      );
    if (error instanceof AiProviderCancelledError)
      return responseError("Conversion cancelled.", 408);
    if (error instanceof AiProviderRateLimitError)
      return responseError(
        "The provider rate-limited this conversion. Try again later.",
        503,
      );
    if (error instanceof AiProviderUnavailableError)
      return responseError(
        "The provider could not convert this source. Check model compatibility with text and structured JSON, or use direct import.",
        502,
      );
    if (error instanceof AiImportResponseError)
      return responseError(error.message, 502);
    if (error instanceof ImportSourceError)
      return responseError(error.message, 400, error.code);
    if (
      error instanceof ImportConversionError ||
      error instanceof AiCredentialRequiredError ||
      error instanceof AiProviderNotConfiguredError
    )
      return responseError(error.message, 400);
    return responseError(
      "The source could not be prepared. No financial records were changed.",
      500,
    );
  } finally {
    if (acquired) activeUsers.delete(session.userId);
  }
}
