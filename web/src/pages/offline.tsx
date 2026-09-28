import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Card, CardHeader, PageHeader } from "@/components/ui/resource";

export function PwaManager() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const updateOnlineState = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.offline = String(!online);
    const blockOfflineMutation = (event: SubmitEvent) => {
      if (online) return;
      const form = event.target;
      if (
        form instanceof HTMLFormElement &&
        form.dataset.financialMutation === "true"
      ) {
        event.preventDefault();
      }
    };
    document.addEventListener("submit", blockOfflineMutation, true);
    return () =>
      document.removeEventListener("submit", blockOfflineMutation, true);
  }, [online]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
    let active = true;
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (!active) return;
      if (registration.waiting) setWaiting(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          )
            setWaiting(worker);
        });
      });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      {!online ? (
        <div className="notice warning" role="status">
          <CloudOff size={16} /> Offline. Changes are blocked until connectivity
          returns.
        </div>
      ) : null}
      {waiting ? (
        <div className="notice warning" role="status">
          An update is ready.
          <button
            className="secondary-button compact"
            onClick={() => {
              waiting.postMessage({ type: "SKIP_WAITING" });
              window.location.reload();
            }}
          >
            <RefreshCw size={16} /> Reload
          </button>
        </div>
      ) : null}
    </>
  );
}

export function OfflinePage() {
  return (
    <>
      <PageHeader
        eyebrow="Connection"
        title="You are offline"
        description="Previously loaded information remains read-only. Changes are never queued for replay."
      />
      <Card>
        <CardHeader title="Reconnect to continue" />
        <p className="read-note">
          Financial mutations, imports, restores, and AI requests require a live
          connection.
        </p>
        <Link className="secondary-button" to="/">
          Return to dashboard
        </Link>
      </Card>
    </>
  );
}
