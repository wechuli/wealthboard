import JSZip from "jszip";
import PDFDocument from "pdfkit";

export function encryptedPdfFixture(
  password: string,
  options: { pdfVersion?: "1.4" | "1.7ext3"; text?: string } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      userPassword: password,
      ownerPassword: "fictional-owner-password",
      pdfVersion: options.pdfVersion ?? "1.7ext3",
      info: { CreationDate: new Date("2025-01-01T00:00:00.000Z") },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.text(options.text ?? "Deposit 123.45 on 2025-01-02");
    document.end();
  });
}

export async function spreadsheetFixture(
  options: { formula?: boolean; external?: boolean; protected?: boolean } = {},
) {
  const archive = new JSZip();
  archive.file(
    "xl/workbook.xml",
    `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${options.protected ? '<workbookProtection workbookPassword="ABCD" lockStructure="1"/>' : ""}<sheets><sheet name="Activity" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  archive.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"${options.external ? ' TargetMode="External"' : ""}/></Relationships>`,
  );
  archive.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c><c r="B1"><v>123.4500</v></c><c r="C1"><v>9007199254740993</v></c>${options.formula ? '<c r="D1"><f>1+1</f><v>2</v></c>' : ""}</row></sheetData>${options.protected ? '<sheetProtection password="ABCD" sheet="1"/>' : ""}</worksheet>`,
  );
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function wordFixture(options: { protected?: boolean } = {}) {
  const archive = new JSZip();
  archive.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  archive.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  archive.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Deposit 123.45 on 2025-01-02</w:t></w:r></w:p></w:body></w:document>',
  );
  if (options.protected) {
    archive.file(
      "word/settings.xml",
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>',
    );
  }
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function pdfFixture(text = "Deposit 123.45 on 2025-01-02") {
  const content = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(document);
}
