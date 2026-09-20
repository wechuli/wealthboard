import { Worker } from "node:worker_threads";
import path from "node:path";

const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const chunks = [];
let length = 0;

for await (const chunk of process.stdin) {
  length += chunk.length;
  if (length > MAX_STDIN_BYTES) process.exit(2);
  chunks.push(chunk);
}

let input;
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    !["pdf", "xlsx", "docx"].includes(input.extension) ||
    typeof input.bytes !== "string" ||
    typeof input.documentPassword !== "string" ||
    input.documentPassword.length > 1024
  ) {
    process.exit(2);
  }
} catch {
  process.exit(2);
}

const worker = new Worker(
  path.join(import.meta.dirname, "extract-import-source.mjs"),
  {
    workerData: {
      extension: input.extension,
      bytes: Buffer.from(input.bytes, "base64"),
      documentPassword: input.documentPassword || undefined,
    },
    env: {},
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
    stdout: true,
    stderr: true,
  },
);

worker.stdout.resume();
worker.stderr.resume();
worker.once("message", (message) => {
  process.stdout.write(JSON.stringify(message));
});
worker.once("error", () => {
  process.stdout.write(
    JSON.stringify({
      error:
        "The document parser could not complete within its resource limits.",
    }),
  );
});
