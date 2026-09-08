import "server-only";

import path from "node:path";
import { Worker } from "node:worker_threads";
import { parse } from "csv-parse/sync";

import {
  IMPORT_SOURCE_MAX_BYTES,
  IMPORT_SOURCE_MAX_UNITS,
  IMPORT_TEXT_MAX_BYTES,
  importSourceSchema,
  type ImportSource,
} from "@/lib/ai/import-schemas";

export class ImportSourceError extends Error {}

export async function extractImportSource(
  name: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<ImportSource> {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (!["pdf", "xlsx", "docx"].includes(extension ?? "")) {
    return extractTextImportSource(name, bytes);
  }
  if (!bytes.length || bytes.length > IMPORT_SOURCE_MAX_BYTES) {
    throw new ImportSourceError(
      "Choose a non-empty source file no larger than 5 MB.",
    );
  }
  if (signal?.aborted) throw new ImportSourceError("Extraction cancelled.");
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(process.cwd(), "scripts/extract-import-source.mjs"),
      {
        workerData: { extension, bytes },
        env: {},
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
        stdout: true,
        stderr: true,
      },
    );
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (error?: Error, source?: ImportSource) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      void worker.terminate();
      if (error) reject(error);
      else resolve(source!);
    };
    const cancel = () => finish(new ImportSourceError("Extraction cancelled."));
    const timer = setTimeout(
      () =>
        finish(
          new ImportSourceError(
            "Document extraction exceeded 15 seconds. Select a smaller file.",
          ),
        ),
      15_000,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    worker.once(
      "message",
      (message: { error?: string; source?: ImportSource }) => {
        if (message.error) return finish(new ImportSourceError(message.error));
        try {
          finish(undefined, validateImportSource(message.source!));
        } catch {
          finish(
            new ImportSourceError(
              "The extracted document is empty or exceeds the source limits.",
            ),
          );
        }
      },
    );
    worker.once("error", () =>
      finish(
        new ImportSourceError(
          "The document parser could not complete within its resource limits.",
        ),
      ),
    );
    worker.once("exit", () =>
      finish(
        new ImportSourceError("Document extraction ended before completion."),
      ),
    );
  });
}

export function validateImportSource(source: ImportSource) {
  const parsed = importSourceSchema.safeParse(source);
  if (
    !parsed.success ||
    Buffer.byteLength(JSON.stringify(source), "utf8") > IMPORT_TEXT_MAX_BYTES
  ) {
    throw new ImportSourceError(
      "Extracted content exceeds 64 KB or 1,000 source sections. Select a smaller source file.",
    );
  }
  if (
    new Set(source.units.map((unit) => unit.id)).size !== source.units.length
  ) {
    throw new ImportSourceError("Source references must be unique.");
  }
  return parsed.data;
}

export function extractTextImportSource(
  name: string,
  bytes: Uint8Array,
): ImportSource {
  if (!bytes.length || bytes.length > IMPORT_SOURCE_MAX_BYTES) {
    throw new ImportSourceError(
      "Choose a non-empty source file no larger than 5 MB.",
    );
  }
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (!["csv", "tsv", "json", "txt"].includes(extension ?? "")) {
    throw new ImportSourceError("Choose a supported text or table file.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    throw new ImportSourceError("Text files must use UTF-8 encoding.");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new ImportSourceError(
      "The file contains binary content, not supported text.",
    );
  }
  const source: ImportSource = { units: [], warnings: [] };
  const add = (location: string, value: string) => {
    if (!value.trim()) return;
    if (source.units.length >= IMPORT_SOURCE_MAX_UNITS) {
      throw new ImportSourceError(
        "The source exceeds 1,000 sections. Select a smaller file.",
      );
    }
    source.units.push({
      id: `source-${source.units.length + 1}`,
      location,
      text: value,
    });
  };
  try {
    if (extension === "csv" || extension === "tsv") {
      const rows = parse(text, {
        delimiter: extension === "tsv" ? "\t" : ",",
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        max_record_size: IMPORT_TEXT_MAX_BYTES,
        info: true,
      }) as unknown as Array<{ record: string[]; info: { lines: number } }>;
      for (const row of rows)
        add(`Row ending at line ${row.info.lines}`, JSON.stringify(row.record));
    } else if (extension === "json") {
      JSON.parse(text);
      add("JSON document", text);
    } else {
      text
        .split(/\r?\n/)
        .forEach((line, index) => add(`Line ${index + 1}`, line));
    }
  } catch (error) {
    if (error instanceof ImportSourceError) throw error;
    throw new ImportSourceError(
      "The source file is malformed. Check its text, JSON, or table format.",
    );
  }
  return validateImportSource(source);
}
