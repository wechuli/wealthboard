// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractSourceFromBytes } from "@/lib/source-extraction/extract";
import { parseDelimited } from "@/lib/source-extraction/text";
import {
  MAX_SOURCE_BYTES,
  SourceExtractionError,
} from "@/lib/source-extraction/source";

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value);

async function extract(
  name: string,
  content: Uint8Array<ArrayBuffer>,
  password = "",
) {
  return extractSourceFromBytes(name, content, password);
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SourceExtractionError);
    return error as SourceExtractionError;
  }
  throw new Error("expected extraction to fail");
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type ZipEntry = {
  name: string;
  content?: string | Uint8Array<ArrayBuffer>;
  deflate?: boolean;
  flags?: number;
  declaredSize?: number;
};

async function zip(entries: ZipEntry[]) {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw =
      typeof entry.content === "string"
        ? bytes(entry.content)
        : (entry.content ?? new Uint8Array());
    const data = entry.deflate ? await deflate(raw) : raw;
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, entry.flags ?? 0, true);
    header.setUint16(8, entry.deflate ? 8 : 0, true);
    header.setUint32(14, crc32(raw), true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, entry.declaredSize ?? raw.length, true);
    header.setUint16(26, name.length, true);
    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, entry.flags ?? 0, true);
    record.setUint16(10, entry.deflate ? 8 : 0, true);
    record.setUint32(16, crc32(raw), true);
    record.setUint32(20, data.length, true);
    record.setUint32(24, entry.declaredSize ?? raw.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    local.push(new Uint8Array(header.buffer), name, data);
    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const directorySize = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let position = 0;
  for (const part of parts) {
    output.set(part, position);
    position += part.length;
  }
  return output;
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;

function workbook(sheetXml: string, extra: ZipEntry[] = []) {
  return zip([
    { name: "[Content_Types].xml", content: contentTypes },
    {
      name: "xl/workbook.xml",
      deflate: true,
      content: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Activity" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/sharedStrings.xml",
      content: `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Deposit</t></si><si><r><t>Fictional </t></r><r><t>salary</t></r></si></sst>`,
    },
    { name: "xl/worksheets/sheet1.xml", deflate: true, content: sheetXml },
    ...extra,
  ]);
}

const sheet = (rows: string) =>
  `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

function documentPart(paragraphs: string[]) {
  return `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
    .join("")}</w:body></w:document>`;
}

function docx(paragraphs: string[], extra: ZipEntry[] = []) {
  return zip([
    { name: "[Content_Types].xml", content: contentTypes },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/document.xml",
      deflate: true,
      content: documentPart(paragraphs),
    },
    ...extra,
  ]);
}

function pdf(pages: string[]) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const text of pages) {
    const stream = text
      ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
      : "0 0 1 rg 0 0 10 10 re f";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + objects.length - 3} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(body);
}

describe("text sources", () => {
  it("parses CSV and TSV with Go encoding/csv rules", () => {
    expect(
      parseDelimited('a,"b ""quoted"", c"\r\n\r\n"multi\r\nline",\n', ","),
    ).toEqual([
      ["a", 'b "quoted", c'],
      ["multi\nline", ""],
    ]);
    expect(parseDelimited("x\ty\n", "\t")).toEqual([["x", "y"]]);
    for (const malformed of ['a,b"c', '"open', '"closed"x,y'])
      expect(() => parseDelimited(malformed, ",")).toThrow(
        "The table file is malformed.",
      );
  });

  it("numbers CSV records, lines, and whole JSON documents", async () => {
    const csv = await extract(
      "activity.csv",
      bytes("\uFEFFid,amount\r\na<1>,10\n\n"),
    );
    expect(csv).toEqual({
      units: [
        { id: "source-1", location: "Row 1", text: '["id","amount"]' },
        { id: "source-2", location: "Row 2", text: '["a<1>","10"]' },
      ],
      warnings: [],
    });
    const text = await extract("notes.txt", bytes("first\r\n  \nthird"));
    expect(text.units.map((unit) => [unit.location, unit.text])).toEqual([
      ["Line 1", "first"],
      ["Line 3", "third"],
    ]);
    const json = await extract("export.json", bytes('{"rows":[1,2]}'));
    expect(json.units).toEqual([
      { id: "source-1", location: "JSON document", text: '{"rows":[1,2]}' },
    ]);
  });

  it("rejects invalid text, unsupported files, and passwords outside PDFs", async () => {
    const cases: Array<[string, Uint8Array<ArrayBuffer>, string, string]> = [
      ["bad.txt", new Uint8Array([0xff, 0xfe, 0x00]), "", "UTF-8"],
      ["binary.txt", bytes("a\u0000b"), "", "binary content"],
      ["export.json", bytes('{"a":1} {"b":2}'), "", "JSON file is malformed"],
      ["empty.txt", bytes("   \n\t"), "", "empty or exceeds"],
      ["statement.xls", bytes("x"), "", "supported text, table, PDF"],
      ["activity.csv", bytes("a,b"), "private-password", "PDF files only"],
      ["empty.csv", new Uint8Array(), "", "non-empty source file"],
      [
        "large.txt",
        new Uint8Array(MAX_SOURCE_BYTES + 1),
        "",
        "no larger than 5 MB",
      ],
      ["long.pdf", pdf(["x"]), "p".repeat(1025), "at most 1,024"],
    ];
    for (const [name, content, password, message] of cases) {
      const error = await rejection(extract(name, content, password));
      expect(error.message).toContain(message);
      expect(error.message).not.toContain("private-password");
    }
  });

  it("enforces the 1,000-section and 64 KB limits", async () => {
    const tooMany = await rejection(
      extract("rows.txt", bytes("value\n".repeat(1001))),
    );
    expect(tooMany.message).toContain("1,000");
    const tooLarge = await rejection(
      extract(
        "rows.txt",
        bytes(`${"x".repeat(40_000)}\n${"y".repeat(30_000)}`),
      ),
    );
    expect(tooLarge.message).toContain("64 KB");
    // Go escapes <, >, and & as six bytes, so 13,000 of them exceed 64 KB there.
    const escaped = await rejection(
      extract("rows.txt", bytes("<".repeat(13_000))),
    );
    expect(escaped.message).toContain("64 KB");
  });
});

describe("office sources", () => {
  it("extracts XLSX rows with shared, rich, inline, and cached formula values", async () => {
    const source = await extract(
      "activity.xlsx",
      await workbook(
        sheet(
          `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
            `<row r="2"><c r="A2" t="inlineStr"><is><t>Fee</t></is></c><c r="B2"><f>1+1</f><v>2</v></c></row>` +
            `<row r="3"><c r="A3"><v> </v></c></row>`,
        ),
      ),
    );
    expect(source.units.map((unit) => unit.location)).toEqual([
      "Workbook context",
      "Sheet Activity, row 1",
      "Sheet Activity, row 2",
    ]);
    expect(JSON.parse(source.units[1].text)).toEqual([
      { cell: "A1", value: "Deposit", format: "0" },
      { cell: "B1", value: "Fictional salary", format: "0" },
    ]);
    expect(JSON.parse(source.units[2].text)[1]).toEqual({
      cell: "B2",
      value: "2",
      format: "0",
    });
    expect(source.units[0].text).toContain("1900");
    expect(source.warnings).toEqual([
      expect.stringContaining("Formula cells use saved cached values"),
    ]);
  });

  it("rejects unsafe or unreadable spreadsheet content", async () => {
    const cases: Array<[Promise<Uint8Array<ArrayBuffer>>, string]> = [
      [
        workbook(sheet(`<row r="1"><c r="A1" t="e"><v>#REF!</v></c></row>`)),
        "error cells",
      ],
      [
        workbook(sheet(`<row r="1"><c r="A1"><f>NOW()</f></c></row>`)),
        "no cached value",
      ],
      [
        workbook(sheet(`<row r="1"><c r="A1" t="s"><v>9</v></c></row>`)),
        "string reference is invalid",
      ],
      [workbook(`<!DOCTYPE x [<!ENTITY a "b">]><worksheet/>`), "malformed XML"],
      [
        workbook(sheet(""), [{ name: "xl/vbaProject.bin", content: "macro" }]),
        "Macros",
      ],
      [
        workbook(sheet(""), [
          {
            name: "xl/worksheets/_rels/sheet1.xml.rels",
            content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="x" Type="link" Target="https://example.com" TargetMode="External"/></Relationships>`,
          },
        ]),
        "external document references",
      ],
    ];
    for (const [archive, message] of cases) {
      const error = await rejection(extract("activity.xlsx", await archive));
      expect(error.message).toContain(message);
    }
  });

  it("extracts DOCX paragraphs through mammoth and flags media", async () => {
    const source = await extract(
      "statement.docx",
      await docx(
        ["Fictional deposit 12.30", "Fictional fee 1.00"],
        [{ name: "word/media/image1.png", content: "png" }],
      ),
    );
    expect(source.units.map((unit) => [unit.location, unit.text])).toEqual([
      ["Paragraph/table section 1", "Fictional deposit 12.30"],
      ["Paragraph/table section 2", "Fictional fee 1.00"],
    ]);
    expect(source.warnings).toEqual([
      expect.stringContaining("Embedded images are not extracted"),
      expect.stringContaining("body paragraphs and tables only"),
    ]);
  });

  it("rejects encrypted, legacy, traversing, oversized, and corrupt archives", async () => {
    const legacy = new Uint8Array(64);
    legacy.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const cases: Array<[Uint8Array<ArrayBuffer>, string, string | undefined]> =
      [
        [
          await zip([{ name: "word/document.xml", content: "x", flags: 1 }]),
          "Encrypted Office ZIP entries",
          "unsupported_encrypted_archive",
        ],
        [legacy, "legacy container", "unsupported_office_container"],
        [
          await zip([{ name: "../evil.xml", content: "x" }]),
          "encrypted, oversized",
          undefined,
        ],
        [
          await zip([{ name: "/abs.xml", content: "x" }]),
          "encrypted, oversized",
          undefined,
        ],
        [
          await zip([
            { name: "a.xml", content: "x" },
            { name: "a.xml", content: "y" },
          ]),
          "encrypted, oversized",
          undefined,
        ],
        [
          await zip([
            {
              name: "word/document.xml",
              deflate: true,
              content: new Uint8Array(21 * 1024 * 1024),
              declaredSize: 1024,
            },
          ]),
          "exceeds 20 MB",
          undefined,
        ],
        [
          await zip([
            { name: "big.xml", content: "x", declaredSize: 21 * 1024 * 1024 },
          ]),
          "encrypted, oversized",
          undefined,
        ],
        [bytes("PK not really a zip"), "corrupt or encrypted", undefined],
      ];
    for (const [archive, message, code] of cases) {
      const error = await rejection(extract("statement.docx", archive));
      expect(error.message).toContain(message);
      expect(error.code).toBe(code);
    }
  });
});

describe("PDF sources", () => {
  it("extracts text per page and warns about pages without text", async () => {
    const source = await extract(
      "statement.pdf",
      pdf(["Fictional deposit 12.30", ""]),
    );
    expect(source.units).toEqual([
      { id: "source-1", location: "Page 1", text: "Fictional deposit 12.30" },
    ]);
    expect(source.warnings).toEqual([
      expect.stringContaining("Page 2 has no extractable text"),
      expect.stringContaining("reading order may be ambiguous"),
    ]);
  });

  it("rejects non-PDF content and PDFs without text", async () => {
    expect(
      (await rejection(extract("statement.pdf", bytes("%PDX")))).message,
    ).toContain("valid text-based PDF");
    expect(
      (await rejection(extract("statement.pdf", pdf([""])))).message,
    ).toContain("No readable text");
  });
});
