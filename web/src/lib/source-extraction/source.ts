import type { AISource } from "@/lib/types";

export type Bytes = Uint8Array<ArrayBuffer>;

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_PASSWORD_LENGTH = 1024;
export const MAX_SOURCE_UNITS = 1000;
export const MAX_SOURCE_WARNINGS = 100;
export const MAX_TEXT_BYTES = 64 * 1024;
export const EXTRACTION_TIMEOUT_MS = 15_000;

export class SourceExtractionError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "SourceExtractionError";
    this.code = code;
  }
}

const encoder = new TextEncoder();
const sourceIdPattern = /^source-[0-9]+$/;

// Measures JSON the way the Go API does: json.Marshal escapes <, >, &, U+2028,
// and U+2029 as six-byte sequences, so a source accepted here is never larger
// when the server re-validates it.
export function encodedSize(value: unknown) {
  return encoder.encode(
    JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, "\\u0000"),
  ).length;
}

function trimmedBytes(value: string) {
  return encoder.encode(value.trim()).length;
}

export class SourceBuilder {
  readonly source: AISource = { units: [], warnings: [] };

  add(location: string, text: string) {
    if (!text.trim()) return;
    if (this.source.units.length >= MAX_SOURCE_UNITS) {
      throw new SourceExtractionError(
        "The source exceeds 1,000 sections. Select a smaller file.",
      );
    }
    this.source.units.push({
      id: `source-${this.source.units.length + 1}`,
      location,
      text,
    });
    if (encodedSize(this.source) > MAX_TEXT_BYTES) {
      throw new SourceExtractionError(
        "Extracted content exceeds 64 KB. Select a smaller source file.",
      );
    }
  }

  warn(message: string) {
    this.source.warnings.push(message);
  }
}

// Mirrors the server's validateSource so a source that extracts here is
// accepted by the conversion endpoint.
export function isValidSource(source: AISource) {
  if (
    source.units.length < 1 ||
    source.units.length > MAX_SOURCE_UNITS ||
    source.warnings.length > MAX_SOURCE_WARNINGS
  )
    return false;
  const seen = new Set<string>();
  for (const unit of source.units) {
    const location = trimmedBytes(unit.location);
    const text = trimmedBytes(unit.text);
    if (
      !sourceIdPattern.test(unit.id) ||
      seen.has(unit.id) ||
      location < 1 ||
      location > 200 ||
      text < 1 ||
      text > MAX_TEXT_BYTES
    )
      return false;
    seen.add(unit.id);
  }
  return encodedSize(source) <= MAX_TEXT_BYTES;
}

export function invalidSourceError() {
  return new SourceExtractionError(
    "The extracted document is empty or exceeds the source limits.",
  );
}
