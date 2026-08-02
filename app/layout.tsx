import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import "@/app/globals.css";
import { PwaManager } from "@/components/pwa-manager";

export const metadata: Metadata = {
  title: {
    default: "Worthboard",
    template: "%s · Worthboard",
  },
  description: "Private, self-hosted wealth and goals tracking.",
  applicationName: "Worthboard",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Worthboard",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090d0d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaManager />
        <Toaster theme="dark" richColors position="top-right" />
      </body>
    </html>
  );
}
