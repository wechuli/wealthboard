import type { AISource } from "@/lib/types";
import { extractSourceFromBytes } from "@/lib/source-extraction/extract";
import { SourceExtractionError } from "@/lib/source-extraction/source";

export type ExtractionRequest = {
  name: string;
  bytes: ArrayBuffer;
  password: string;
};

// pdf.js attaches its own message handler to a worker's global scope and posts
// "ready" to the page, so replies carry a marker the page can recognize.
export const EXTRACTION_RESPONSE = "wealthboard-source-extraction";

export type ExtractionResponse = { kind: typeof EXTRACTION_RESPONSE } & (
  { source: AISource } | { error: string; code?: string }
);

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ExtractionRequest>) => void) | null;
  postMessage(message: ExtractionResponse): void;
};

scope.onmessage = (event) => {
  const { name, bytes, password } = event.data;
  extractSourceFromBytes(name, new Uint8Array(bytes), password).then(
    (source) => scope.postMessage({ kind: EXTRACTION_RESPONSE, source }),
    (error: unknown) =>
      scope.postMessage({
        kind: EXTRACTION_RESPONSE,
        ...(error instanceof SourceExtractionError
          ? { error: error.message, code: error.code }
          : {
              error:
                "The document could not be extracted. Check its format and contents.",
            }),
      }),
  );
};
