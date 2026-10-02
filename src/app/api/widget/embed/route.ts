import { NextResponse, type NextRequest } from "next/server";

import { publicAgentUrls } from "@/server/agent-public/urls";

/**
 * The embeddable widget's snippet (spec §45, Phase 10): a business pastes
 *
 *   <script src="https://<root>/api/widget/embed?tenant=<slug>" async></script>
 *
 * into their own site. It lives under `/api/` (never rewritten or
 * locale-redirected by `src/proxy.ts`, same reasoning as the payment
 * webhook route) and returns plain JavaScript, not a page — it must be
 * fetchable and runnable from any third-party origin, so CORS is
 * deliberately wide open here (there is no data in the response to
 * protect; the tenant slug is already public, the same value shared as
 * the standalone External Agent's own link).
 *
 * The script itself does nothing but inject a floating launcher button
 * and an iframe pointing at `src/app/agent/widget/[slug]/page.tsx` —
 * every actual behavior (the chat, the catalog, the cart) lives in that
 * page, not here.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("tenant");
  if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug)) {
    return new NextResponse("// missing or invalid ?tenant=", { status: 400, headers: { "content-type": "application/javascript" } });
  }

  const widgetUrl = publicAgentUrls().widget(slug);

  const script = `(function () {
  if (window.__smartManagerWidgetLoaded) return;
  window.__smartManagerWidgetLoaded = true;

  var OPEN_SIZE = { width: "360px", height: "560px" };
  var open = false;

  var launcher = document.createElement("button");
  launcher.setAttribute("aria-label", "Open chat");
  launcher.textContent = "💬";
  launcher.style.cssText =
    "position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:9999px;" +
    "background:#171717;color:#fff;border:none;font-size:24px;cursor:pointer;z-index:2147483000;" +
    "box-shadow:0 4px 14px rgba(0,0,0,0.25);";

  var iframe = document.createElement("iframe");
  iframe.src = ${JSON.stringify(widgetUrl)};
  iframe.title = "Chat";
  // Lets customers speak to the Agent (speech is transcribed by their own browser).
  iframe.allow = "microphone";
  iframe.style.cssText =
    "position:fixed;bottom:88px;right:20px;width:0;height:0;border:none;border-radius:12px;" +
    "box-shadow:0 8px 30px rgba(0,0,0,0.25);z-index:2147483000;background:#fff;display:none;";

  launcher.addEventListener("click", function () {
    open = !open;
    if (open) {
      iframe.style.width = OPEN_SIZE.width;
      iframe.style.height = OPEN_SIZE.height;
      iframe.style.display = "block";
    } else {
      iframe.style.display = "none";
    }
  });

  document.body.appendChild(iframe);
  document.body.appendChild(launcher);
})();
`;

  return new NextResponse(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
