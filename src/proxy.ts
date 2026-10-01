import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { resolveConsolePath } from "@/lib/console-routing";
import { LOCALE_COOKIE, LOCALES, negotiateLocale, splitLocaleFromPath, type Locale } from "@/i18n/locales";
import { publicEnv } from "@/lib/env.public";
import { agentSubpath, classifyHost } from "@/lib/hosts";
import { serverEnv } from "@/server/env-core";
import { timed } from "@/server/perf";

/**
 * Request entry point (Next.js "proxy", Node.js runtime).
 *
 *   hostname ──► classifyHost ──► platform | console | agent
 *
 * Public URLs on the platform/console hosts are always `/<locale>/…`;
 * console paths are decided by `resolveConsolePath` (redirect a legacy
 * shape to its canonical one, rewrite a canonical shape to its internal
 * route tree, or fall through to the marketing site):
 *
 *   platform    /fr/pricing        → /site/fr/pricing
 *   console     /en/roasters-cafe  → /console/en/t/roasters-cafe   (rewrite)
 *   console     /en/t/roasters-cafe → /en/roasters-cafe            (redirect)
 *   console     /en/platform       → /en/super-admin               (redirect)
 *
 * The customer-facing Agent is path-based on the platform host —
 * `<root>/agent/<tenant-slug>` (canonical) or `<root>/<locale>/agent/<slug>`
 * — both rewritten to the internal `/agent/…` tree. The canonical form
 * carries no locale segment (addendum §17: a clean, shareable link);
 * locale is negotiated silently (cookie/Accept-Language) and the URL is
 * never redirected to inject one. A dedicated Agent host
 * (`AGENT_SUBDOMAIN`) is still routed the same way when requests arrive
 * there, for a future verified DNS record (`AGENT_URL`).
 *
 * On a host that can't serve `CONSOLE_SUBDOMAIN` as a real subdomain
 * (`CONSOLE_URL`, see `env-core.ts`), the platform host also answers
 * console requests directly, disambiguated by path instead of by host —
 * `resolveConsolePath` is exactly what makes that disambiguation possible,
 * and every console route's own `redirect()`/`Link` calls emit the
 * canonical shape it expects (see `src/lib/reserved-slugs.ts` for the
 * fixed words a tenant slug can never collide with).
 */
const INTERNAL_HEADERS = ["x-site-area", "x-next-intl-locale", "x-nonce", "content-security-policy"];

/**
 * Script CSP is nonce-based (Next's documented proxy-nonce pattern,
 * `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`)
 * — it must be computed per-request here, not in `next.config.ts`'s static
 * `headers()`, which cannot express a per-request value. `frame-ancestors`
 * stays path-dependent (spec §45: the widget page is the one route meant to
 * be framed by a tenant's own site; everything else must never be
 * frameable), keyed off the same external `/widget/…` shape
 * `next.config.ts` used to split on, now folded into this single dynamic
 * source of truth.
 */
/** The embeddable widget page, on the Agent host (`/widget/…`) or path-based (`/agent/widget/…`, optionally locale-prefixed). */
export function isWidgetPath(pathname: string): boolean {
  return /^(?:\/(?:en|ar|fr))?(?:\/agent)?\/widget\//.test(pathname);
}

function buildCsp(nonce: string, pathname: string): string {
  const frameAncestors = isWidgetPath(pathname) ? "*" : "'none'";
  // worker-src/manifest-src: the console's PWA service worker (`/sw.js`) and
  // manifest are same-origin files; without worker-src the worker would be
  // judged against the nonce-only script-src.
  return `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; worker-src 'self'; manifest-src 'self'; frame-ancestors ${frameAncestors}; base-uri 'self'; object-src 'none'`;
}

function withCsp(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export async function proxy(request: NextRequest) {
  let env: ReturnType<typeof serverEnv>;
  try {
    env = serverEnv();
  } catch (err) {
    // serverEnv() runs on every request; an invalid value (never a missing
    // one — every field here has a default) throws and, uncaught, would
    // otherwise surface as an opaque "Internal Server Error" with no way to
    // tell which variable is wrong. Log field names/messages only, never
    // values, then keep failing the same way (a config bug should still be
    // visible as a 500, not silently masked).
    console.error("[proxy] serverEnv() rejected the current environment:", err instanceof Error ? err.message : err);
    throw err;
  }
  const site = classifyHost(request.headers.get("host"), {
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
  });

  const { pathname, search } = request.nextUrl;
  const { locale: pathLocale, rest } = splitLocaleFromPath(pathname);
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const acceptLanguage = request.headers.get("accept-language");

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, pathname);

  const withLocale = () => {
    if (pathLocale) return { redirect: null, locale: pathLocale };
    const locale = negotiateLocale({ allowed: LOCALES, fallback: "en", cookie: cookieLocale, acceptLanguage });
    const target = `/${locale}${pathname === "/" ? "" : pathname}${search}`;
    return { redirect: sameHostRedirect(request, target, env.PUBLIC_URL_SCHEME), locale };
  };

  const requestHeaders = new Headers(request.headers);
  for (const header of INTERNAL_HEADERS) requestHeaders.delete(header);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const rewrite = (internalPath: string, locale: Locale) => {
    requestHeaders.set("x-next-intl-locale", locale);
    const url = request.nextUrl.clone();
    url.pathname = internalPath;
    url.search = search;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  };

  const renderConsole = async (internalPath: string) => {
    const { redirect, locale } = withLocale();
    if (redirect) return redirect;
    requestHeaders.set("x-site-area", "console");
    return refreshSession(request, requestHeaders, (headers) => {
      headers.set("x-next-intl-locale", locale);
      const url = request.nextUrl.clone();
      url.pathname = `/console/${locale}${internalPath}`;
      url.search = search;
      return NextResponse.rewrite(url, { request: { headers } });
    });
  };

  const redirectToCanonical = (to: string) => {
    const { redirect, locale } = withLocale();
    if (redirect) return redirect;
    return sameHostRedirect(request, `/${locale}${to}${search}`, env.PUBLIC_URL_SCHEME);
  };

  // The customer-facing Agent, path-based on the platform host:
  //   /agent/<slug>            (canonical, no locale — negotiated silently)
  //   /<locale>/agent/<slug>   (explicit locale)
  // Public, no session refresh: the Agent never uses a subscriber session.
  const renderAgent = (subpath: string) => {
    const locale = pathLocale ?? negotiateLocale({ allowed: LOCALES, fallback: "en", cookie: cookieLocale, acceptLanguage });
    requestHeaders.set("x-site-area", "agent");
    return withCsp(rewrite(`/agent${subpath}`, locale), csp);
  };

  switch (site.kind) {
    case "invalid":
      return withCsp(new NextResponse("Unknown host", { status: 400 }), csp);

    case "platform": {
      const agentPath = agentSubpath(rest);
      if (agentPath !== null) return renderAgent(agentPath);
      const decision = resolveConsolePath(rest);
      if (decision.kind === "redirect") return withCsp(redirectToCanonical(decision.to), csp);
      if (decision.kind === "rewrite") return withCsp(await renderConsole(decision.internalPath), csp);
      const { redirect, locale } = withLocale();
      if (redirect) return withCsp(redirect, csp);
      requestHeaders.set("x-site-area", "platform");
      return withCsp(rewrite(`/site/${locale}${rest}`, locale), csp);
    }

    case "console": {
      const agentPath = agentSubpath(rest);
      if (agentPath !== null) return renderAgent(agentPath);
      const decision = resolveConsolePath(rest);
      if (decision.kind === "redirect") return withCsp(redirectToCanonical(decision.to), csp);
      return withCsp(await renderConsole(decision.kind === "rewrite" ? decision.internalPath : ""), csp);
    }

    case "agent": {
      const locale = negotiateLocale({ allowed: LOCALES, fallback: "en", cookie: cookieLocale, acceptLanguage });
      requestHeaders.set("x-site-area", "agent");
      return withCsp(rewrite(`/agent${pathname === "/" ? "" : pathname}`, locale), csp);
    }
  }
}

function sameHostRedirect(request: NextRequest, path: string, defaultScheme: "http" | "https"): NextResponse {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const scheme = forwarded === "http" || forwarded === "https" ? forwarded : defaultScheme;
  return NextResponse.redirect(new URL(path, `${scheme}://${host}`), 307);
}

/**
 * Refreshes the Supabase auth session (rotating tokens when needed) and
 * forwards the updated cookies both to the page render and to the browser.
 */
async function refreshSession(
  request: NextRequest,
  requestHeaders: Headers,
  buildResponse: (headers: Headers) => NextResponse,
): Promise<NextResponse> {
  const pending: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const responseHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
            pending.push(cookie);
          }
          Object.assign(responseHeaders, headers);
        },
      },
    },
  );

  await timed("proxy.refreshSession", supabase.auth.getClaims());

  if (pending.length > 0) {
    requestHeaders.set("cookie", request.cookies.toString());
  }
  const response = buildResponse(requestHeaders);
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options);
  }
  for (const [key, value] of Object.entries(responseHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    // PWA files (`/sw.js`, `/manifest.webmanifest`) are served as-is, never rewritten.
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|sw\\.js$|manifest\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
