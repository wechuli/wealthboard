import { describe, expect, it } from "vitest";

import {
  extractImportSource,
  extractTextImportSource,
  validateImportSource,
} from "@/lib/services/import-source";
import {
  pdfFixture,
  spreadsheetFixture,
  wordFixture,
} from "@/tests/fixtures/import-documents";

const bytes = (text: string) => Buffer.from(text, "utf8");

describe("local import source extraction", () => {
  it("preserves CSV decimals, quoted text, and source locations", () => {
    const source = extractTextImportSource(
      "bank.csv",
      bytes('Date,Amount,Note\n2025-01-02,123.4500,"A, B"\n'),
    );
    expect(source.units[1]).toEqual({
      id: "source-2",
      location: "Row ending at line 2",
      text: '["2025-01-02","123.4500","A, B"]',
    });
  });

  it("supports TSV and keeps original JSON numeric lexemes intact", () => {
    expect(
      extractTextImportSource(
        "bank.tsv",
        bytes("Amount\tDate\n1.2000\t2025-01-01"),
      ).units[1].text,
    ).toBe('["1.2000","2025-01-01"]');
    const json = '[{"amount":9007199254740993,"price":1.23000}]';
    expect(
      extractTextImportSource("bank.json", bytes(json)).units[0].text,
    ).toBe(json);
  });

  it("rejects malformed, binary, unsupported, empty, and excessive input", () => {
    expect(() => extractTextImportSource("bank.json", bytes("{"))).toThrow(
      "malformed",
    );
    expect(() =>
      extractTextImportSource("bank.txt", bytes("\0binary")),
    ).toThrow("binary");
    expect(() => extractTextImportSource("bank.exe", bytes("text"))).toThrow(
      "supported",
    );
    expect(() => extractTextImportSource("bank.txt", bytes(""))).toThrow(
      "non-empty",
    );
    expect(() =>
      extractTextImportSource("bank.txt", bytes("row\n".repeat(1001))),
    ).toThrow("1,000");
    expect(() =>
      extractTextImportSource("bank.txt", bytes("a".repeat(65537))),
    ).toThrow("64 KB");
  });

  it("rejects duplicate source references", () => {
    const unit = { id: "source-1", location: "Line 1", text: "Deposit 10" };
    expect(() =>
      validateImportSource({ units: [unit, unit], warnings: [] }),
    ).toThrow("unique");
  });

  it("rejects corrupt office documents and non-PDF bytes in the isolated worker", async () => {
    await expect(
      extractImportSource("bank.xlsx", bytes("not a zip")),
    ).rejects.toThrow("corrupt");
    await expect(
      extractImportSource("bank.pdf", bytes("not a PDF")),
    ).rejects.toThrow("valid text-based PDF");
  });

  it("honors cancellation before document parsing", async () => {
    await expect(
      extractImportSource("bank.docx", bytes("content"), AbortSignal.abort()),
    ).rejects.toThrow("cancelled");
  });

  it("extracts XLSX numeric lexemes losslessly and flags cached formula values", async () => {
    const source = await extractImportSource(
      "bank.xlsx",
      await spreadsheetFixture({ formula: true }),
    );
    expect(source.units[1].text).toContain('"123.4500"');
    expect(source.units[1].text).toContain('"9007199254740993"');
    expect(source.units[1].location).toBe("Sheet Activity, row 1");
    expect(source.warnings.join(" ")).toContain("cached");
    await expect(
      extractImportSource(
        "bank.xlsx",
        await spreadsheetFixture({ external: true }),
      ),
    ).rejects.toThrow("external document");
  });

  it("extracts Word paragraphs and text PDF pages without OCR", async () => {
    const word = await extractImportSource("bank.docx", await wordFixture());
    expect(word.units[0].text).toContain("Deposit 123.45 on 2025-01-02");
    const pdf = await extractImportSource("bank.pdf", pdfFixture());
    expect(pdf.units[0]).toMatchObject({
      location: "Page 1",
      text: "Deposit 123.45 on 2025-01-02",
    });
    await expect(
      extractImportSource("blank.pdf", pdfFixture("")),
    ).rejects.toThrow("No readable text");
  });
});
