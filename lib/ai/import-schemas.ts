import { z } from "zod";

export const IMPORT_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_TEXT_MAX_BYTES = 64 * 1024;
export const IMPORT_SOURCE_MAX_UNITS = 1000;
export const IMPORT_DOCUMENT_PASSWORD_MAX_LENGTH = 1024;
export const importDocumentPasswordSchema = z
  .string()
  .max(IMPORT_DOCUMENT_PASSWORD_MAX_LENGTH)
  .optional();
export const importSourceErrorCodeSchema = z.enum([
  "password_required",
  "incorrect_password",
  "unsupported_office_container",
  "unsupported_encrypted_archive",
]);
export type ImportSourceErrorCode = z.infer<typeof importSourceErrorCodeSchema>;

export const importSourceUnitSchema = z
  .object({
    id: z.string().regex(/^source-\d+$/),
    location: z.string().min(1).max(200),
    text: z.string().min(1).max(IMPORT_TEXT_MAX_BYTES),
  })
  .strict();

export const importSourceSchema = z
  .object({
    units: z.array(importSourceUnitSchema).min(1).max(IMPORT_SOURCE_MAX_UNITS),
    warnings: z.array(z.string().max(500)).max(100),
  })
  .strict();

export type ImportSource = z.infer<typeof importSourceSchema>;
export type ImportSourceUnit = z.infer<typeof importSourceUnitSchema>;

export const importConversionRequestSchema = z
  .object({
    source: importSourceSchema,
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    consent: z.literal(true),
    apiKey: z.string().min(8).max(4096).optional(),
  })
  .strict();

export const importExtractionSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceCurrency: z.string().nullable(),
    records: z
      .array(
        z
          .object({
            collection: z.enum([
              "transactions",
              "instruments",
              "position_events",
              "cash_transactions",
              "prices",
            ]),
            sourceIds: z.array(z.string()).min(1).max(100),
            fields: z
              .array(
                z
                  .object({
                    name: z.enum([
                      "external_id",
                      "type",
                      "amount",
                      "date",
                      "description",
                      "notes",
                      "name",
                      "symbol",
                      "identifier_type",
                      "identifier",
                      "exchange_mic",
                      "asset_type",
                      "quote_currency",
                      "instrument_external_id",
                      "quantity",
                      "unit_price",
                      "trade_currency",
                      "fee_amount",
                      "fee_currency",
                      "cash_effect",
                      "applied_exchange_rate",
                      "opening_cost_basis",
                      "event_group_id",
                      "trade_date",
                      "settlement_date",
                      "price",
                      "effective_date",
                      "source",
                      "provenance",
                    ]),
                    value: z.string().max(2000).nullable(),
                  })
                  .strict(),
              )
              .min(1)
              .max(30),
          })
          .strict(),
      )
      .max(1000),
    exclusions: z
      .array(
        z
          .object({
            sourceId: z.string(),
            reason: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(1000),
    issues: z.array(z.string().min(1).max(500)).max(100),
  })
  .strict();

export type ImportExtraction = z.infer<typeof importExtractionSchema>;
export type ImportConversionRequest = z.infer<
  typeof importConversionRequestSchema
>;

export type ImportProviderView = {
  provider: string;
  host: string;
  model: string;
  hasStoredApiKey: boolean;
  maxOutputTokens: number;
  configurationHash: string;
};

export type ImportConversionResult = {
  content: string;
  references: Array<{ collection: string; row: number; sourceIds: string[] }>;
  exclusions: ImportExtraction["exclusions"];
  issues: string[];
};
