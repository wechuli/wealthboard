import {
  SourceBuilder,
  SourceExtractionError,
  type Bytes,
} from "@/lib/source-extraction/source";

const pdfHeader = [0x25, 0x50, 0x44, 0x46, 0x2d];

export async function extractPdf(
  bytes: Bytes,
  password: string,
  builder: SourceBuilder,
  progress: { stage: string },
) {
  if (!pdfHeader.every((value, index) => bytes[index] === value))
    throw new SourceExtractionError("Choose a valid text-based PDF.");
  progress.stage = "pdf-module";
  // Run pdf.js on this thread. Extraction already happens inside a dedicated,
  // terminable Web Worker, so pdf.js needs no nested worker of its own.
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker =
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const { getDocument, OPS, PasswordResponses } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  progress.stage = "pdf-initialization";
  const task = getDocument({
    data: bytes,
    password,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    maxImageSize: 10_000_000,
    verbosity: 0,
  });
  const imageOperations = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
  ]);
  try {
    progress.stage = "pdf-document";
    const document = await task.promise;
    if (document.numPages > 100)
      throw new SourceExtractionError("PDFs are limited to 100 pages.");
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      progress.stage = "pdf-text";
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) =>
          "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
        )
        .join("")
        .trim();
      if (!pageText)
        builder.warn(
          `Page ${index} has no extractable text. Scanned pages require OCR and are not supported.`,
        );
      else builder.add(`Page ${index}`, pageText);
      progress.stage = "pdf-images";
      const operators = await page.getOperatorList();
      if (operators.fnArray.some((operation) => imageOperations.has(operation)))
        builder.warn(
          `Page ${index} contains image content that was not extracted. Check for excluded financial activity.`,
        );
      page.cleanup();
    }
    builder.warn(
      "PDF table columns and reading order may be ambiguous. Compare the extracted text with the original pages.",
    );
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "PasswordException") {
      const incorrect =
        (error as { code?: number }).code ===
        PasswordResponses.INCORRECT_PASSWORD;
      throw new SourceExtractionError(
        incorrect
          ? "The PDF password is incorrect. Enter it again and retry extraction."
          : "This PDF requires a password. Enter its document password and retry extraction.",
        incorrect ? "incorrect_password" : "password_required",
      );
    }
    throw error;
  } finally {
    await task.destroy();
  }
}
