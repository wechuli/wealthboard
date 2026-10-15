import type { AISource } from "@/lib/types";
import {
  EXTRACTION_TIMEOUT_MS,
  MAX_PASSWORD_LENGTH,
  MAX_SOURCE_BYTES,
  SourceExtractionError,
} from "@/lib/source-extraction/source";
import type {
  ExtractionRequest,
  ExtractionResponse,
} from "@/lib/source-extraction/worker";

// Mirrors EXTRACTION_RESPONSE in worker.ts without importing the worker module.
const EXTRACTION_RESPONSE = "wealthboard-source-extraction";

export { MAX_PASSWORD_LENGTH, MAX_SOURCE_BYTES, SourceExtractionError };

// Extracts a source file entirely in this browser. Parsing runs in a dedicated
// Web Worker that is terminated on completion, timeout, or abort; the file and
// any PDF password never leave the device.
export async function extractSource(
  file: File,
  password: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<AISource> {
  if (!file.size || file.size > MAX_SOURCE_BYTES)
    throw new SourceExtractionError(
      "Choose a non-empty source file no larger than 5 MB.",
    );
  signal?.throwIfAborted();
  const bytes = await file.arrayBuffer();
  signal?.throwIfAborted();
  return new Promise<AISource>((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "source-extraction",
    });
    const settle = (complete: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      complete();
    };
    const abort = () => settle(() => reject(signal?.reason));
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new SourceExtractionError(
              "Document extraction exceeded 15 seconds. Select a smaller file.",
            ),
          ),
        ),
      EXTRACTION_TIMEOUT_MS,
    );
    const failed = (event: Event) => {
      event.preventDefault();
      settle(() =>
        reject(
          new SourceExtractionError(
            "The document parser could not complete within its resource limits.",
          ),
        ),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = failed;
    worker.onmessageerror = failed;
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data as Partial<ExtractionResponse> | null;
      if (response?.kind !== EXTRACTION_RESPONSE) return;
      settle(() => {
        if ("source" in response && response.source) resolve(response.source);
        else if ("error" in response && response.error)
          reject(new SourceExtractionError(response.error, response.code));
        else
          reject(
            new SourceExtractionError(
              "The document could not be extracted. Check its format and contents.",
            ),
          );
      });
    };
    const request: ExtractionRequest = { name: file.name, bytes, password };
    worker.postMessage(request, [bytes]);
  });
}
