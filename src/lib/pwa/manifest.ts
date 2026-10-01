import type { MetadataRoute } from "next";

/**
 * The installable app (PWA) is the subscriber/Super Admin console. Its
 * entry point is `/subscriber`, the console's explicit bare entry on every
 * host (`resolveConsolePath`): the proxy adds the visitor's locale, and the
 * console entry sends a signed-in user to their own business (whatever its
 * slug) or to the login page when the session has expired — the app never
 * opens past authentication, and no business slug is baked in here.
 */
export const PWA_START_URL = "/subscriber";
export const PWA_THEME_COLOR = "#111827";
export const PWA_BACKGROUND_COLOR = "#ffffff";

export function pwaManifest(): MetadataRoute.Manifest {
  return {
    id: PWA_START_URL,
    name: "SmartManager AI Agent",
    short_name: "AI Agent",
    description: "SmartManager AI Agent — intelligent ordering and business automation.",
    start_url: PWA_START_URL,
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-256.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/icons/icon-384.png", sizes: "384x384", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
