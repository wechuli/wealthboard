import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";

// Fictional document fixtures for browser-side source extraction tests.

const pdfPadding = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);

function rc4(key: Buffer, data: Buffer) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = Buffer.alloc(data.length);
  for (let index = 0, i = 0, j = 0; index < data.length; index += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[index] = data[index] ^ state[(state[i] + state[j]) & 0xff];
  }
  return output;
}

const md5 = (...parts: Buffer[]) =>
  createHash("md5").update(Buffer.concat(parts)).digest();
const padPassword = (value: string) =>
  Buffer.concat([Buffer.from(value, "latin1"), pdfPadding]).subarray(0, 32);

// Builds a text PDF, optionally encrypted with the PDF 1.1 standard security
// handler (revision 2, 40-bit RC4) so pdf.js requires the user password.
export function pdfDocument(
  pages: string[],
  encryption?: { userPassword: string; ownerPassword: string },
) {
  const objects: Array<{
    dictionary: string;
    stream?: Buffer<ArrayBufferLike>;
  }> = [
    { dictionary: "<< /Type /Catalog /Pages 2 0 R >>" },
    {
      dictionary: `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    },
    { dictionary: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
  ];
  for (const text of pages) {
    objects.push(
      {
        dictionary: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
      },
      {
        dictionary: "",
        stream: Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, "latin1"),
      },
    );
  }
  const documentId = md5(Buffer.from("wealthboard-fixture"));
  let fileKey: Buffer<ArrayBufferLike> | undefined;
  let encryptReference = "";
  if (encryption) {
    const permissions = Buffer.alloc(4);
    permissions.writeInt32LE(-44);
    const owner = rc4(
      md5(padPassword(encryption.ownerPassword)).subarray(0, 5),
      padPassword(encryption.userPassword),
    );
    fileKey = md5(
      padPassword(encryption.userPassword),
      owner,
      permissions,
      documentId,
    ).subarray(0, 5);
    const user = rc4(fileKey, pdfPadding);
    objects.push({
      dictionary: `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -44 >>`,
    });
    encryptReference = ` /Encrypt ${objects.length} 0 R`;
  }
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let length = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(length);
    let body = object.dictionary;
    let stream: Buffer<ArrayBufferLike> | undefined = object.stream;
    if (stream) {
      if (fileKey) {
        const reference = Buffer.alloc(5);
        reference.writeUIntLE(index + 1, 0, 3);
        stream = rc4(md5(fileKey, reference).subarray(0, 10), stream);
      }
      body = `<< /Length ${stream.length} >>\nstream\n`;
    }
    const parts: Buffer<ArrayBufferLike>[] = [
      Buffer.from(`${index + 1} 0 obj\n${body}`, "latin1"),
    ];
    if (stream) parts.push(stream, Buffer.from("\nendstream", "latin1"));
    parts.push(Buffer.from("\nendobj\n", "latin1"));
    for (const part of parts) {
      chunks.push(part);
      length += part.length;
    }
  });
  const id = documentId.toString("hex");
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptReference} /ID [<${id}> <${id}>] >>\nstartxref\n${length}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(chunks);
}

function zip(entries: Array<{ name: string; content: string }>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.content);
    const data = deflateRawSync(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(crc32(raw), 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;

export function xlsxWorkbook(rows: string[][]) {
  const cells = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, column) =>
              `<c r="${String.fromCharCode(65 + column)}${rowIndex + 1}" t="inlineStr"><is><t>${value}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  return zip([
    { name: "[Content_Types].xml", content: contentTypes },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Activity" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`,
    },
  ]);
}

export function docxDocument(paragraphs: string[]) {
  return zip([
    { name: "[Content_Types].xml", content: contentTypes },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/document.xml",
      content: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
        .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
        .join("")}</w:body></w:document>`,
    },
  ]);
}
