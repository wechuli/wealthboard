import type { AISource } from "@/lib/types";
import {
  invalidSourceError,
  isValidSource,
  SourceBuilder,
  SourceExtractionError,
  type Bytes,
} from "@/lib/source-extraction/source";

export type TextExtension = "txt" | "csv" | "tsv" | "json";

const strictUTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decode(bytes: Bytes) {
  let text: string;
  try {
    text = strictUTF8.decode(bytes);
  } catch {
    throw new SourceExtractionError("Text files must use UTF-8 encoding.");
  }
  text = text.replace(/^\uFEFF/, "");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    throw new SourceExtractionError(
      "The file contains binary content, not supported text.",
    );
  }
  return text;
}

function malformedTable() {
  return new SourceExtractionError("The table file is malformed.");
}

// Parses delimited text with the same rules as Go's encoding/csv reader:
// RFC 4180 quoting, no bare quotes in unquoted fields, CRLF normalized inside
// quoted fields, blank lines skipped, and a variable number of fields.
export function parseDelimited(text: string, delimiter: string) {
  const records: string[][] = [];
  const length = text.length;
  const lineEndAt = (index: number) =>
    text[index] === "\n" || (text[index] === "\r" && text[index + 1] === "\n");
  let index = 0;
  while (index < length) {
    if (lineEndAt(index)) {
      index += text[index] === "\r" ? 2 : 1;
      continue;
    }
    const record: string[] = [];
    for (;;) {
      let field = "";
      if (text[index] === '"') {
        index += 1;
        for (;;) {
          if (index >= length) throw malformedTable();
          const character = text[index];
          if (character === '"') {
            if (text[index + 1] === '"') {
              field += '"';
              index += 2;
              continue;
            }
            index += 1;
            break;
          }
          if (character === "\r" && text[index + 1] === "\n") {
            field += "\n";
            index += 2;
            continue;
          }
          field += character;
          index += 1;
        }
        if (index < length && text[index] !== delimiter && !lineEndAt(index))
          throw malformedTable();
      } else {
        const start = index;
        while (index < length && text[index] !== delimiter && !lineEndAt(index))
          index += 1;
        field = text.slice(start, index);
        if (field.includes('"')) throw malformedTable();
      }
      record.push(field);
      if (index < length && text[index] === delimiter) {
        index += 1;
        continue;
      }
      break;
    }
    if (index < length) index += text[index] === "\r" ? 2 : 1;
    records.push(record);
  }
  return records;
}

export function extractText(extension: TextExtension, bytes: Bytes): AISource {
  const text = decode(bytes);
  const builder = new SourceBuilder();
  if (extension === "csv" || extension === "tsv") {
    parseDelimited(text, extension === "tsv" ? "\t" : ",").forEach(
      (record, index) =>
        builder.add(`Row ${index + 1}`, JSON.stringify(record)),
    );
  } else if (extension === "json") {
    try {
      JSON.parse(text);
    } catch {
      throw new SourceExtractionError("The JSON file is malformed.");
    }
    builder.add("JSON document", text);
  } else {
    text
      .replaceAll("\r\n", "\n")
      .split("\n")
      .forEach((line, index) =>
        builder.add(`Line ${index + 1}`, line.replace(/\r$/, "")),
      );
  }
  if (!isValidSource(builder.source)) throw invalidSourceError();
  return builder.source;
}
