import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const settings = await getSettings();
  return (
    <AppShell appName={settings.appName} displayName={settings.displayName}>
      {children}
    </AppShell>
  );
}
