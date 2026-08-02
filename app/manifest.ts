import type { MetadataRoute } from "next";

import { PRODUCT_NAME } from "@/lib/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: "Worthboard",
    description: "Private, self-hosted wealth and goals tracking.",
    start_url: "/",
    display: "standalone",
    background_color: "#090d0d",
    theme_color: "#090d0d",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Add account", short_name: "Account", url: "/accounts/new" },
      { name: "Record deposit", short_name: "Deposit", url: "/transactions/new?type=deposit" },
      { name: "Create goal", short_name: "Goal", url: "/goals/new" },
    ],
  };
}
