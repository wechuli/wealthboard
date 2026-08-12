import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PwaManager } from "@/components/pwa-manager";

const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker",
);

describe("PWA manager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (serviceWorkerDescriptor) {
      Object.defineProperty(
        navigator,
        "serviceWorker",
        serviceWorkerDescriptor,
      );
    } else {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("clears stale Wealthboard workers and caches outside production", async () => {
    const unregisterWealthboard = vi.fn().mockResolvedValue(true);
    const unregisterUnrelated = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([
      {
        active: { scriptURL: `${window.location.origin}/sw.js` },
        waiting: null,
        installing: null,
        unregister: unregisterWealthboard,
      },
      {
        active: { scriptURL: `${window.location.origin}/other-worker.js` },
        waiting: null,
        installing: null,
        unregister: unregisterUnrelated,
      },
    ]);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations },
    });
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {
      keys: vi
        .fn()
        .mockResolvedValue([
          "wealthboard-shell-v1",
          "wealthboard-shell-v2",
          "another-app-cache",
        ]),
      delete: deleteCache,
    });

    render(<PwaManager />);

    await waitFor(() => expect(getRegistrations).toHaveBeenCalledOnce());
    expect(unregisterWealthboard).toHaveBeenCalledOnce();
    expect(unregisterUnrelated).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(deleteCache).toHaveBeenCalledWith("wealthboard-shell-v1");
    expect(deleteCache).toHaveBeenCalledWith("wealthboard-shell-v2");
    expect(deleteCache).not.toHaveBeenCalledWith("another-app-cache");
  });
});
