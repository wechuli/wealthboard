import { XMLParser, XMLValidator } from "fast-xml-parser";

import {
  SourceBuilder,
  SourceExtractionError,
  type Bytes,
} from "@/lib/source-extraction/source";
import { readZip } from "@/lib/source-extraction/zip";

type Node = Record<string, unknown> & { "#text"?: string };

const text = new TextDecoder();
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

function xml(bytes: Bytes | undefined): Node {
  const content = bytes ? text.decode(bytes) : "";
  if (
    !content ||
    /<!DOCTYPE|<!ENTITY/i.test(content) ||
    XMLValidator.validate(content) !== true
  ) {
    throw new SourceExtractionError(
      "The document contains unsupported or malformed XML.",
    );
  }
  return parser.parse(content) as Node;
}

const array = <T = Node>(value: unknown): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value as T];
const child = (node: unknown, key: string) =>
  (node as Node | undefined)?.[key] as Node | undefined;
const attribute = (node: unknown, key: string) =>
  (node as Node | undefined)?.[`@_${key}`] as string | undefined;
const plainText = (value: unknown) =>
  typeof value === "string"
    ? value
    : ((value as Node | undefined)?.["#text"] ?? "");
const richText = (value: unknown) =>
  plainText(child(value, "t")) ||
  array(child(value, "r"))
    .map((run) => plainText(run.t))
    .join("");

function normalizePath(value: string) {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const legacyContainer = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export async function extractOffice(
  extension: "xlsx" | "docx",
  bytes: Bytes,
  builder: SourceBuilder,
) {
  if (legacyContainer.every((value, index) => bytes[index] === value)) {
    throw new SourceExtractionError(
      "This Office file uses an encrypted or legacy container. Password-to-open XLSX/DOCX files are not supported yet. Open it in Excel or Word and export an unencrypted XLSX, DOCX, or CSV copy; renaming it is not enough.",
      "unsupported_office_container",
    );
  }
  const entries = await readZip(bytes);
  for (const [name, content] of entries) {
    if (/vbaProject|embeddings\/|externalLinks\//i.test(name)) {
      throw new SourceExtractionError(
        "Macros, embedded documents, and external workbook links are unsupported.",
      );
    }
    if (name.endsWith(".rels")) {
      const relations = array(
        child(child(xml(content), "Relationships"), "Relationship"),
      );
      if (
        relations.some(
          (relation) => attribute(relation, "TargetMode") === "External",
        )
      ) {
        throw new SourceExtractionError(
          "Remove external document references before importing.",
        );
      }
    }
  }
  if ([...entries.keys()].some((name) => /\/media\//.test(name))) {
    builder.warn(
      "Embedded images are not extracted. Review the original document and acknowledge any excluded image content.",
    );
  }
  if (extension === "docx") await extractDocx(entries, bytes, builder);
  else extractXlsx(entries, builder);
}

async function extractDocx(
  entries: Map<string, Bytes>,
  bytes: Bytes,
  builder: SourceBuilder,
) {
  if (!entries.has("word/document.xml"))
    throw new SourceExtractionError("Choose a valid DOCX document.");
  xml(entries.get("word/document.xml"));
  const { default: mammoth } = await import("mammoth");
  // Browsers read `arrayBuffer`; the Node build used by unit tests reads `buffer`.
  const input = { arrayBuffer: bytes.slice().buffer, buffer: bytes };
  const result = await mammoth.extractRawText(
    input as unknown as Parameters<typeof mammoth.extractRawText>[0],
  );
  if (result.messages.length)
    builder.warn(
      "The Word parser reported unsupported formatting or elements. Check the original document for missing content.",
    );
  builder.warn(
    "Word extraction includes body paragraphs and tables only. Check headers, footers, drawings, and text boxes for excluded activity.",
  );
  result.value
    .split(/\n\s*\n/)
    .forEach((section, index) =>
      builder.add(`Paragraph/table section ${index + 1}`, section),
    );
}

function extractXlsx(entries: Map<string, Bytes>, builder: SourceBuilder) {
  if (!entries.has("xl/workbook.xml"))
    throw new SourceExtractionError("Choose a valid XLSX workbook.");
  const workbook = child(xml(entries.get("xl/workbook.xml")), "workbook");
  const relations = array(
    child(
      child(xml(entries.get("xl/_rels/workbook.xml.rels")), "Relationships"),
      "Relationship",
    ),
  );
  const strings = entries.has("xl/sharedStrings.xml")
    ? array(
        child(child(xml(entries.get("xl/sharedStrings.xml")), "sst"), "si"),
      ).map(richText)
    : [];
  const styles = entries.has("xl/styles.xml")
    ? child(xml(entries.get("xl/styles.xml")), "styleSheet")
    : undefined;
  const formats = new Map(
    array(child(child(styles, "numFmts"), "numFmt")).map((format) => [
      attribute(format, "numFmtId"),
      attribute(format, "formatCode"),
    ]),
  );
  const cellStyles = array(child(child(styles, "cellXfs"), "xf"));
  const sheets = array(child(child(workbook, "sheets"), "sheet"));
  if (!sheets.length || sheets.length > 20)
    throw new SourceExtractionError(
      "Workbooks must contain between 1 and 20 sheets.",
    );
  let hasFormula = false;
  const date1904 = attribute(child(workbook, "workbookPr"), "date1904");
  builder.add(
    "Workbook context",
    `Excel date system: ${date1904 === "1" || date1904 === "true" ? "1904" : "1900"}. Values are original cell text; formula values are cached, not recalculated.`,
  );
  for (const sheet of sheets) {
    const relation = relations.find(
      (item) => attribute(item, "Id") === attribute(sheet, "r:id"),
    );
    const target = attribute(relation, "Target");
    if (!target)
      throw new SourceExtractionError("A workbook sheet reference is missing.");
    const fileName = target.startsWith("/")
      ? target.slice(1)
      : normalizePath(`xl/${target}`);
    if (!fileName.startsWith("xl/"))
      throw new SourceExtractionError(
        "The workbook contains an unsupported sheet reference.",
      );
    const worksheet = child(xml(entries.get(fileName)), "worksheet");
    if (!worksheet)
      throw new SourceExtractionError(
        "The workbook contains an unsupported sheet type.",
      );
    for (const row of array(child(child(worksheet, "sheetData"), "row"))) {
      const cells = array(row.c).map((cell) => {
        if (cell.f != null) hasFormula = true;
        if (cell.f != null && cell.v == null)
          throw new SourceExtractionError(
            "A formula has no cached value. Export values only before importing.",
          );
        if (attribute(cell, "t") === "e")
          throw new SourceExtractionError(
            "Resolve spreadsheet error cells before importing.",
          );
        const style = cellStyles[Number(attribute(cell, "s") ?? "0")];
        const type = attribute(cell, "t");
        const value =
          type === "s"
            ? strings[Number(plainText(cell.v))]
            : type === "inlineStr"
              ? richText(cell.is)
              : plainText(cell.v);
        if (value == null)
          throw new SourceExtractionError(
            "A spreadsheet string reference is invalid.",
          );
        const formatId = attribute(style, "numFmtId");
        return {
          cell: attribute(cell, "r"),
          value,
          format: formats.get(formatId) ?? formatId ?? "0",
        };
      });
      if (cells.some((cell) => cell.value.trim()))
        builder.add(
          `Sheet ${attribute(sheet, "name")}, row ${attribute(row, "r")}`,
          JSON.stringify(cells),
        );
    }
  }
  if (hasFormula)
    builder.warn(
      "Formula cells use saved cached values and may be stale. Confirm them against the original statement before conversion.",
    );
}
