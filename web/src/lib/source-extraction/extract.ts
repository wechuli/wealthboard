import type { AISource } from "@/lib/types";
import { extractOffice } from "@/lib/source-extraction/office";
import { extractPdf } from "@/lib/source-extraction/pdf";
import {
  invalidSourceError,
  isValidSource,
  MAX_PASSWORD_LENGTH,
  MAX_SOURCE_BYTES,
  SourceBuilder,
  SourceExtractionError,
  type Bytes,
} from "@/lib/source-extraction/source";
import { extractText } from "@/lib/source-extraction/text";

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

// Converts one source file into bounded, numbered text sections. It runs inside
// the extraction Web Worker in the browser and directly in unit tests.
export async function extractSourceFromBytes(
  name: string,
  bytes: Bytes,
  password: string,
): Promise<AISource> {
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES)
    throw new SourceExtractionError(
      "Choose a non-empty source file no larger than 5 MB.",
    );
  if (password.length > MAX_PASSWORD_LENGTH)
    throw new SourceExtractionError(
      "The document password must be at most 1,024 characters.",
    );
  const extension = extensionOf(name);
  if (password && extension !== "pdf")
    throw new SourceExtractionError(
      "Document passwords are supported for PDF files only.",
    );
  switch (extension) {
    case "txt":
    case "csv":
    case "tsv":
    case "json":
      return extractText(extension, bytes);
    case "pdf":
    case "xlsx":
    case "docx":
      return extractDocument(extension, bytes, password);
    default:
      throw new SourceExtractionError(
        "Choose a supported text, table, PDF, XLSX, or DOCX file.",
      );
  }
}

async function extractDocument(
  extension: "pdf" | "xlsx" | "docx",
  bytes: Bytes,
  password: string,
) {
  const builder = new SourceBuilder();
  const progress = { stage: "archive" };
  try {
    if (extension === "pdf")
      await extractPdf(bytes, password, builder, progress);
    else await extractOffice(extension, bytes, builder);
  } catch (error) {
    if (error instanceof SourceExtractionError) throw error;
    throw new SourceExtractionError(
      `The document could not be extracted (${progress.stage}). Check its format and contents.`,
    );
  }
  if (!builder.source.units.length)
    throw new SourceExtractionError(
      "No readable text was found. Scanned documents and images require OCR, which is not supported.",
    );
  if (!isValidSource(builder.source)) throw invalidSourceError();
  return builder.source;
}
