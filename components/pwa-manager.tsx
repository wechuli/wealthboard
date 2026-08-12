"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

async function clearDevelopmentServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) =>
        [
          registration.active,
          registration.waiting,
          registration.installing,
        ].some(
          (worker) => worker && new URL(worker.scriptURL).pathname === "/sw.js",
        ),
      )
      .map((registration) => registration.unregister()),
  );
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("wealthboard-"))
      .map((key) => caches.delete(key)),
  );
}

export function PwaManager() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV !== "production") {
        void clearDevelopmentServiceWorkers().catch(() => {
          // Development remains usable if browser storage cannot be cleared.
        });
      } else {
        navigator.serviceWorker
          .register("/sw.js", { updateViaCache: "none" })
          .then((registration) => {
            if (registration.waiting) {
              toast.info("A Wealthboard update is available.", {
                action: {
                  label: "Reload",
                  onClick: () => window.location.reload(),
                },
              });
            }
            registration.addEventListener("updatefound", () => {
              const worker = registration.installing;
              worker?.addEventListener("statechange", () => {
                if (
                  worker.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  toast.info("A Wealthboard update is ready.", {
                    action: {
                      label: "Reload",
                      onClick: () => window.location.reload(),
                    },
                  });
                }
              });
            });
          })
          .catch(() => {
            // The application remains usable without service-worker registration.
          });
      }
    }

    const syncOnlineState = () => {
      document.documentElement.dataset.offline = String(!navigator.onLine);
    };
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const preventOfflineSubmission = (event: Event) => {
      if (navigator.onLine) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toast.error("Reconnect before making financial changes.");
    };
    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    document.addEventListener("submit", preventOfflineSubmission, true);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      document.removeEventListener("submit", preventOfflineSubmission, true);
    };
  }, []);

  if (!installPrompt) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="fixed bottom-24 right-4 z-30 shadow-xl md:bottom-5"
      onClick={async () => {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === "accepted") setInstallPrompt(null);
      }}
    >
      <Download size={15} />
      Install app
    </Button>
  );
}
