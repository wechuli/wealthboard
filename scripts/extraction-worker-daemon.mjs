import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 80 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const parserPath = path.join(import.meta.dirname, "extract-import-source.mjs");

export function clearEnvironment(environment, preserved = []) {
  const allowed = new Set(preserved);
  for (const key of Object.keys(environment)) {
    if (!allowed.has(key)) delete environment[key];
  }
}

function errorResponse(message = "The document parser could not complete within its resource limits.") {
  return { error: message };
}

function encodeResponse(response) {
  const encoded = Buffer.from(JSON.stringify(response));
  if (encoded.length <= MAX_RESPONSE_BYTES) return encoded;
  return Buffer.from(JSON.stringify(errorResponse()));
}

function decodeRequest(chunks) {
  const raw = Buffer.concat(chunks);
  try {
    const input = JSON.parse(raw.toString("utf8"));
    if (
      !["pdf", "xlsx", "docx"].includes(input.extension) ||
      typeof input.bytes !== "string" ||
      typeof input.documentPassword !== "string" ||
      input.documentPassword.length > 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        input.bytes,
      )
    ) {
      throw new Error("invalid request");
    }
    const documentBytes = Buffer.from(input.bytes, "base64");
    if (!documentBytes.length || documentBytes.length > MAX_SOURCE_BYTES) {
      documentBytes.fill(0);
      throw new Error("invalid document size");
    }
    const request = {
      extension: input.extension,
      bytes: documentBytes,
      documentPassword: input.documentPassword,
    };
    input.bytes = "";
    input.documentPassword = "";
    return request;
  } finally {
    raw.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

async function extract(request) {
  return new Promise((resolve) => {
    const worker = new Worker(parserPath, {
      workerData: request,
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
      stdout: true,
      stderr: true,
    });
    request.bytes.fill(0);
    request.documentPassword = "";
    worker.stdout.resume();
    worker.stderr.resume();

    let finished = false;
    const finish = (response) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      void worker.terminate();
      resolve(response);
    };
    const timeout = setTimeout(() => finish(errorResponse()), REQUEST_TIMEOUT_MS);
    timeout.unref();
    worker.once("message", finish);
    worker.once("error", () => finish(errorResponse()));
    worker.once("exit", (code) => {
      if (code !== 0) finish(errorResponse());
    });
  });
}

function handleConnection(socket) {
  const chunks = [];
  let length = 0;
  let complete = false;
  const finish = (response) => {
    if (complete) return;
    complete = true;
    for (const chunk of chunks) chunk.fill(0);
    socket.end(encodeResponse(response));
  };
  socket.setTimeout(REQUEST_TIMEOUT_MS, () => finish(errorResponse()));
  socket.on("data", (chunk) => {
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES) {
      chunk.fill(0);
      finish(errorResponse("The document extraction request is too large."));
      return;
    }
    chunks.push(chunk);
  });
  socket.once("end", async () => {
    if (complete) return;
    try {
      finish(await extract(decodeRequest(chunks)));
    } catch {
      finish(errorResponse("The document extraction request is invalid."));
    }
  });
  socket.once("error", () => {
    complete = true;
    for (const chunk of chunks) chunk.fill(0);
  });
}

export function startServer(socketPath) {
  if (!path.isAbsolute(socketPath)) {
    throw new Error("AI_EXTRACTION_SOCKET must be an absolute path");
  }
  try {
    const existing = fs.lstatSync(socketPath);
    if (!existing.isSocket()) throw new Error("socket path is not a socket");
    fs.unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const server = net.createServer(handleConnection);
  server.maxConnections = 4;
  server.listen(socketPath, () => fs.chmodSync(socketPath, 0o660));
  return server;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const socketPath = process.env.AI_EXTRACTION_SOCKET;
  clearEnvironment(process.env);
  if (!socketPath) throw new Error("AI_EXTRACTION_SOCKET is required");
  process.umask(0o077);
  const server = startServer(socketPath);
  const shutdown = () => server.close(() => fs.rmSync(socketPath, { force: true }));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}