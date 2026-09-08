import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import yauzl from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const { bytes, extension } = workerData;
const buffer = Buffer.from(bytes);
const source = { units: [], warnings: [] };
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
class SourceError extends Error {}
let stage = "archive";

function add(location, text) {
  if (!text.trim()) return;
  source.units.push({
    id: `source-${source.units.length + 1}`,
    location,
    text,
  });
  if (
    source.units.length > 1000 ||
    Buffer.byteLength(JSON.stringify(source)) > 64 * 1024
  ) {
    throw new SourceError(
      "Extracted content exceeds 64 KB or 1,000 sections. Select a smaller source file.",
    );
  }
}

function xml(bytes) {
  const content = bytes?.toString("utf8");
  if (
    !content ||
    /<!DOCTYPE|<!ENTITY/i.test(content) ||
    XMLValidator.validate(content) !== true
  ) {
    throw new SourceError(
      "The document contains unsupported or malformed XML.",
    );
  }
  return new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  }).parse(content);
}

const array = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const plainText = (value) =>
  typeof value === "string" ? value : (value?.["#text"] ?? "");
const richText = (value) =>
  plainText(value?.t) ||
  array(value?.r)
    .map((run) => plainText(run.t))
    .join("");

async function unzip() {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, archive) => {
        if (error)
          return reject(
            new SourceError("The document archive is corrupt or encrypted."),
          );
        const entries = new Map();
        let expanded = 0;
        let count = 0;
        const fail = (cause) => {
          archive.close();
          reject(cause);
        };
        archive.on("error", () =>
          fail(new SourceError("The document archive could not be read.")),
        );
        archive.on("entry", (entry) => {
          count += 1;
          if (
            count > 2000 ||
            entry.generalPurposeBitFlag & 1 ||
            entry.uncompressedSize > MAX_EXPANDED_BYTES ||
            entries.has(entry.fileName) ||
            entry.fileName.startsWith("/") ||
            entry.fileName.split("/").includes("..")
          ) {
            return fail(
              new SourceError(
                "The document archive is encrypted, oversized, or unsupported.",
              ),
            );
          }
          if (entry.fileName.endsWith("/")) return archive.readEntry();
          archive.openReadStream(entry, (streamError, stream) => {
            if (streamError)
              return fail(
                new SourceError("The document archive could not be read."),
              );
            const chunks = [];
            stream.on("error", () =>
              fail(new SourceError("The document archive could not be read.")),
            );
            stream.on("data", (chunk) => {
              expanded += chunk.length;
              if (expanded > MAX_EXPANDED_BYTES) {
                stream.destroy();
                return fail(
                  new SourceError("The expanded document exceeds 20 MB."),
                );
              }
              chunks.push(chunk);
            });
            stream.on("end", () => {
              entries.set(entry.fileName, Buffer.concat(chunks));
              archive.readEntry();
            });
          });
        });
        archive.on("end", () => resolve(entries));
        archive.readEntry();
      },
    );
  });
}

async function extractOffice() {
  const entries = await unzip();
  for (const [name, content] of entries) {
    if (/vbaProject|embeddings\/|externalLinks\//i.test(name)) {
      throw new SourceError(
        "Macros, embedded documents, and external workbook links are unsupported.",
      );
    }
    if (name.endsWith(".rels")) {
      const relations = array(xml(content).Relationships?.Relationship);
      if (
        relations.some((relation) => relation["@_TargetMode"] === "External")
      ) {
        throw new SourceError(
          "Remove external document references before importing.",
        );
      }
    }
  }
  if ([...entries.keys()].some((name) => /\/media\//.test(name))) {
    source.warnings.push(
      "Embedded images are not extracted. Review the original document and acknowledge any excluded image content.",
    );
  }
  if (extension === "docx") {
    if (!entries.has("word/document.xml"))
      throw new SourceError("Choose a valid DOCX document.");
    xml(entries.get("word/document.xml"));
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    if (result.messages.length)
      source.warnings.push(
        "The Word parser reported unsupported formatting or elements. Check the original document for missing content.",
      );
    source.warnings.push(
      "Word extraction includes body paragraphs and tables only. Check headers, footers, drawings, and text boxes for excluded activity.",
    );
    result.value
      .split(/\n\s*\n/)
      .forEach((text, index) =>
        add(`Paragraph/table section ${index + 1}`, text),
      );
    return;
  }
  if (!entries.has("xl/workbook.xml"))
    throw new SourceError("Choose a valid XLSX workbook.");
  const workbook = xml(entries.get("xl/workbook.xml")).workbook;
  const relations = array(
    xml(entries.get("xl/_rels/workbook.xml.rels")).Relationships?.Relationship,
  );
  const strings = entries.has("xl/sharedStrings.xml")
    ? array(xml(entries.get("xl/sharedStrings.xml")).sst?.si).map(richText)
    : [];
  const styles = entries.has("xl/styles.xml")
    ? xml(entries.get("xl/styles.xml")).styleSheet
    : {};
  const formats = new Map(
    array(styles.numFmts?.numFmt).map((format) => [
      format["@_numFmtId"],
      format["@_formatCode"],
    ]),
  );
  const cellStyles = array(styles.cellXfs?.xf);
  const sheets = array(workbook.sheets?.sheet);
  if (!sheets.length || sheets.length > 20)
    throw new SourceError("Workbooks must contain between 1 and 20 sheets.");
  let hasFormula = false;
  add(
    "Workbook context",
    `Excel date system: ${["1", "true"].includes(workbook.workbookPr?.["@_date1904"]) ? "1904" : "1900"}. Values are original cell text; formula values are cached, not recalculated.`,
  );
  for (const sheet of sheets) {
    const relation = relations.find((item) => item["@_Id"] === sheet["@_r:id"]);
    const target = relation?.["@_Target"];
    if (!target)
      throw new SourceError("A workbook sheet reference is missing.");
    const fileName = target.startsWith("/")
      ? target.slice(1)
      : path.posix.normalize(`xl/${target}`);
    if (!fileName.startsWith("xl/"))
      throw new SourceError(
        "The workbook contains an unsupported sheet reference.",
      );
    const worksheet = xml(entries.get(fileName)).worksheet;
    if (!worksheet)
      throw new SourceError("The workbook contains an unsupported sheet type.");
    for (const row of array(worksheet.sheetData?.row)) {
      const cells = array(row.c).map((cell) => {
        if (cell.f != null) hasFormula = true;
        if (cell.f != null && cell.v == null)
          throw new SourceError(
            "A formula has no cached value. Export values only before importing.",
          );
        if (cell["@_t"] === "e")
          throw new SourceError(
            "Resolve spreadsheet error cells before importing.",
          );
        const style = cellStyles[Number(cell["@_s"] ?? "0")];
        const value =
          cell["@_t"] === "s"
            ? strings[Number(plainText(cell.v))]
            : cell["@_t"] === "inlineStr"
              ? richText(cell.is)
              : plainText(cell.v);
        if (value == null)
          throw new SourceError("A spreadsheet string reference is invalid.");
        return {
          cell: cell["@_r"],
          value,
          format:
            formats.get(style?.["@_numFmtId"]) ?? style?.["@_numFmtId"] ?? "0",
        };
      });
      if (cells.some((cell) => cell.value.trim()))
        add(
          `Sheet ${sheet["@_name"]}, row ${row["@_r"]}`,
          JSON.stringify(cells),
        );
    }
  }
  if (hasFormula)
    source.warnings.push(
      "Formula cells use saved cached values and may be stale. Confirm them against the original statement before conversion.",
    );
}

async function extractPdf() {
  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new SourceError("Choose a valid text-based PDF.");
  stage = "pdf-module";
  globalThis.pdfjsWorker =
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  stage = "pdf-initialization";
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    enableXfa: false,
    maxImageSize: 10_000_000,
    verbosity: 0,
  });
  try {
    stage = "pdf-document";
    const document = await task.promise;
    if (document.numPages > 100)
      throw new SourceError("PDFs are limited to 100 pages.");
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      stage = "pdf-text";
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
        )
        .join("")
        .trim();
      if (!text)
        source.warnings.push(
          `Page ${index} has no extractable text. Scanned pages require OCR and are not supported.`,
        );
      else add(`Page ${index}`, text);
      stage = "pdf-images";
      const operators = await page.getOperatorList();
      if (
        operators.fnArray.some((operation) =>
          [
            OPS.paintImageXObject,
            OPS.paintInlineImageXObject,
            OPS.paintImageMaskXObject,
          ].includes(operation),
        )
      ) {
        source.warnings.push(
          `Page ${index} contains image content that was not extracted. Check for excluded financial activity.`,
        );
      }
      page.cleanup();
    }
    source.warnings.push(
      "PDF table columns and reading order may be ambiguous. Compare the extracted text with the original pages.",
    );
  } finally {
    await task.destroy();
  }
}

try {
  if (extension === "pdf") await extractPdf();
  else await extractOffice();
  if (!source.units.length)
    throw new SourceError(
      "No readable text was found. Scanned documents and images require OCR, which is not supported.",
    );
  parentPort.postMessage({ source });
} catch (error) {
  const message =
    error?.name === "PasswordException"
      ? "Password-protected PDFs are unsupported. Upload an unencrypted text-based copy."
      : error instanceof SourceError
        ? error.message
        : `The document could not be extracted (${stage}${["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(error?.code) ? ": missing parser module" : ""}). Check its format and contents.`;
  parentPort.postMessage({ error: message });
}
