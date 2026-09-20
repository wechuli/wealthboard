import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearEnvironment,
  startServer,
} from "../../scripts/extraction-worker-daemon.mjs";

async function request(socketPath, body) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.createConnection(socketPath, () => socket.end(body));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("end", () => resolve(Buffer.concat(chunks)));
    socket.once("error", reject);
  });
}

async function withServer(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "wealthboard-extract-"),
  );
  const socketPath = path.join(directory, "worker.sock");
  const server = startServer(socketPath);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    await run(socketPath);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("socket is private and accepts exactly one bounded request", async () => {
  await withServer(async (socketPath) => {
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o660);
    const response = await request(socketPath, "{}");
    assert.ok(response.length < 80 * 1024);
    assert.deepEqual(JSON.parse(response), {
      error: "The document extraction request is invalid.",
    });
  });
});

test("oversize requests receive a bounded response without echoed content", async () => {
  await withServer(async (socketPath) => {
    const secret = "not-for-output";
    const response = await request(
      socketPath,
      Buffer.alloc(8 * 1024 * 1024 + 1, secret.charCodeAt(0)),
    );
    assert.ok(response.length < 80 * 1024);
    assert.doesNotMatch(response.toString("utf8"), new RegExp(secret));
  });
});

test("valid requests invoke the parser without echoing document passwords", async () => {
  await withServer(async (socketPath) => {
    const password = "private-document-password";
    const response = await request(
      socketPath,
      JSON.stringify({
        extension: "pdf",
        bytes: Buffer.from("%PDF-invalid").toString("base64"),
        documentPassword: password,
      }),
    );
    assert.ok(response.length < 80 * 1024);
    assert.doesNotMatch(response.toString("utf8"), new RegExp(password));
    assert.match(JSON.parse(response).error, /document|PDF|parser/i);
  });
});

test("environment clearing preserves no inherited secrets", () => {
  const environment = {
    PATH: "/bin",
    DATABASE_URL: "secret",
    API_KEY: "secret",
  };
  clearEnvironment(environment);
  assert.deepEqual(environment, {});
});
