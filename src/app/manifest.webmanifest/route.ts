import { pwaManifest } from "@/lib/pwa/manifest";

export const dynamic = "force-dynamic";

/**
 * `/manifest.webmanifest` — linked only from the console (its layout's
 * `metadata.manifest`), so the customer-facing Agent and the marketing
 * site never offer to install the subscriber app.
 */
export function GET() {
  return new Response(JSON.stringify(pwaManifest()), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Revalidated on every fetch so a changed manifest reaches installed apps.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
