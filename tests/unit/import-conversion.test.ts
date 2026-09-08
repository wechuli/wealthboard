import { describe, expect, it } from "vitest";

import type { ImportExtraction } from "@/lib/ai/import-schemas";
import { buildImportDraft } from "@/lib/services/import-conversion";

const source = {
  units: [
    {
      id: "source-1",
      location: "Row 1",
      text: "2025-01-02 Deposit 12.30 USD bank-123",
    },
  ],
  warnings: [],
};
const extraction: ImportExtraction = {
  schemaVersion: 1,
  sourceCurrency: "USD",
  records: [
    {
      collection: "transactions",
      sourceIds: ["source-1"],
      fields: [
        { name: "date", value: "2025-01-02" },
        { name: "type", value: "deposit" },
        { name: "amount", value: "12.3000" },
      ],
    },
  ],
  exclusions: [],
  issues: [],
};

describe("AI import drafts", () => {
  it("generates stable financial identities independent of field order or commentary", () => {
    const original = JSON.parse(
      buildImportDraft(extraction, source, "balance", "USD").content,
    );
    const reordered = structuredClone(extraction);
    reordered.records[0].fields.reverse();
    reordered.records[0].fields.push({ name: "description", value: "Deposit" });
    const repeated = JSON.parse(
      buildImportDraft(reordered, source, "balance", "USD").content,
    );
    expect(original.transactions[0].external_id).toBe(
      repeated.transactions[0].external_id,
    );
    expect(original.transactions[0].amount).toBe("12.3");
  });

  it("preserves source IDs but rejects invented IDs, unknown evidence, and identity collisions", () => {
    const value = structuredClone(extraction);
    value.records[0].fields.push({ name: "external_id", value: "bank-123" });
    expect(buildImportDraft(value, source, "balance", "USD").content).toContain(
      "bank-123",
    );
    value.records[0].fields.at(-1)!.value = "invented";
    expect(() => buildImportDraft(value, source, "balance", "USD")).toThrow(
      "not present",
    );
    value.records[0].sourceIds = ["unknown"];
    expect(() => buildImportDraft(value, source, "balance", "USD")).toThrow(
      "unknown",
    );
    expect(() =>
      buildImportDraft(
        {
          ...extraction,
          records: [extraction.records[0], extraction.records[0]],
        },
        source,
        "balance",
        "USD",
      ),
    ).toThrow("duplicate");
  });

  it("flags unaccounted content and currency mismatches and rejects the wrong account contract", () => {
    const draft = buildImportDraft(
      extraction,
      {
        ...source,
        units: [
          ...source.units,
          { id: "source-2", location: "Row 2", text: "Missing withdrawal" },
        ],
      },
      "balance",
      "KES",
    );
    expect(draft.issues).toHaveLength(2);
    expect(() =>
      buildImportDraft(extraction, source, "positions", "USD"),
    ).toThrow("wrong account");
  });
});
