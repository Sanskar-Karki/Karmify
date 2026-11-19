import type { MetadataRoute } from "next";

/**
 * Lets Karmify be installed on a phone or computer as its own app: its name,
 * icon, and opening full-screen (no browser bars) on the dashboard.
 * The icons are made from the header's "K" tile (public/icons, app/icon.png).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "Karmify",
    short_name: "Karmify",
    description: "Orders, stock and sales for Karmalu.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    // The page background and the top bar, so the splash screen and status bar match the app.
    background_color: "#f4f4f6",
    theme_color: "#ffffff",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the app icon for these.
    shortcuts: [
      { name: "New sale", short_name: "POS", url: "/sales", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "New note", short_name: "Note", url: "/notes?new=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Orders", url: "/customers", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Analytics", url: "/analytics", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
