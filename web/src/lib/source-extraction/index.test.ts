// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractSource, SourceExtractionError } from "@/lib/source-extraction";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const file = () =>
  new File(["id,amount\n1,2"], "statement.csv", { type: "text/csv" });

async function started() {
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
  return FakeWorker.instances[0];
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("extractSource", () => {
  it("ignores messages pdf.js posts to the page and resolves on its own reply", async () => {
    const pending = extractSource(file(), "");
    const worker = await started();
    expect(worker.posted).toEqual([
      expect.objectContaining({ name: "statement.csv", password: "" }),
    ]);
    worker.reply({ targetName: "main", action: "ready" });
    worker.reply(null);
    expect(worker.terminated).toBe(false);
    const source = {
      units: [{ id: "source-1", location: "Row 1", text: '["id"]' }],
      warnings: [],
    };
    worker.reply({ kind: "wealthboard-source-extraction", source });
    await expect(pending).resolves.toEqual(source);
    expect(worker.terminated).toBe(true);
  });

  it("rejects with the worker's error and code", async () => {
    const pending = extractSource(file(), "");
    (await started()).reply({
      kind: "wealthboard-source-extraction",
      error: "This PDF requires a password.",
      code: "password_required",
    });
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SourceExtractionError);
    expect(error).toMatchObject({
      message: "This PDF requires a password.",
      code: "password_required",
    });
  });

  it("terminates the worker after 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = extractSource(file(), "");
    const worker = await started();
    vi.advanceTimersByTime(15_000);
    await expect(pending).rejects.toThrow(
      "Document extraction exceeded 15 seconds",
    );
    expect(worker.terminated).toBe(true);
  });

  it("terminates the worker when aborted", async () => {
    const controller = new AbortController();
    const pending = extractSource(file(), "", { signal: controller.signal });
    const worker = await started();
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(worker.terminated).toBe(true);
  });

  it("reports worker crashes without exposing details", async () => {
    const pending = extractSource(file(), "");
    const worker = await started();
    worker.onerror?.(new Event("error"));
    await expect(pending).rejects.toThrow(
      "The document parser could not complete within its resource limits.",
    );
    expect(worker.terminated).toBe(true);
  });

  it("rejects empty and oversized files before starting a worker", async () => {
    await expect(extractSource(new File([], "empty.csv"), "")).rejects.toThrow(
      "non-empty source file no larger than 5 MB",
    );
    await expect(
      extractSource(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf"),
        "",
      ),
    ).rejects.toThrow("no larger than 5 MB");
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
