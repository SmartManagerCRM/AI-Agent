import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { LOCALE_COOKIE, LOCALES, negotiateLocale, splitLocaleFromPath, type Locale } from "@/i18n/locales";
import { publicEnv } from "@/lib/env.public";
import { classifyHost } from "@/lib/hosts";
import { serverEnv } from "@/server/env-core";

/**
 * Request entry point (Next.js "proxy", Node.js runtime).
 *
 *   hostname ──► classifyHost ──► platform | console | agent
 *
 * Public URLs on the platform/console hosts are always `/<locale>/…`;
 * they are rewritten to internal route trees that carry the area:
 *
 *   platform    /fr/pricing    → /site/fr/pricing
 *   console     /ar/t/acme     → /console/ar/t/acme
 *
 * The agent host is different on purpose (addendum §17: a clean,
 * shareable link) — `agent.<root>/<tenant-slug>` carries no locale segment
 * at all; locale is negotiated silently (cookie/Accept-Language) and the
 * URL is never redirected to inject one.
 *
 * On a host that can't serve `CONSOLE_SUBDOMAIN` as a real subdomain
 * (`CONSOLE_URL`, see `env-core.ts`), the platform host also answers
 * console requests directly, disambiguated by path instead of by host:
 * every console route's own `redirect()`/`Link` calls already emit the
 * bare, unprefixed shape (`/${locale}/t/${slug}`, `/${locale}/login`, …
 * — see `src/app/console/[locale]/page.tsx`'s comment), and none of those
 * shapes collide with the platform's own routes (it only has one:
 * `/${locale}` itself), so they can be recognized directly. The one shape
 * the console has no unprefixed form for is its own bare entry
 * (`/${locale}` — already the platform's marketing homepage), so
 * `/subscriber` exists purely as a stable, bookmarkable alias for that.
 */
const INTERNAL_HEADERS = ["x-site-area", "x-next-intl-locale", "x-nonce", "content-security-policy"];

const CONSOLE_PATH_RE = /^\/(?:subscriber|login|onboarding|platform)(?:\/|$)|^\/(?:t|invite)\//;

/** The `/subscriber` alias has no route of its own under `/console/[locale]` — it stands in for the bare entry. */
function stripSubscriberAlias(rest: string): string {
  if (rest === "/subscriber") return "";
  if (rest.startsWith("/subscriber/")) return rest.slice("/subscriber".length);
  return rest;
}

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
function buildCsp(nonce: string, pathname: string): string {
  const frameAncestors = pathname.startsWith("/widget/") ? "*" : "'none'";
  return `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; frame-ancestors ${frameAncestors}; base-uri 'self'; object-src 'none'`;
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

  const renderConsole = async () => {
    const { redirect, locale } = withLocale();
    if (redirect) return redirect;
    requestHeaders.set("x-site-area", "console");
    return refreshSession(request, requestHeaders, (headers) => {
      headers.set("x-next-intl-locale", locale);
      const url = request.nextUrl.clone();
      url.pathname = `/console/${locale}${stripSubscriberAlias(rest)}`;
      url.search = search;
      return NextResponse.rewrite(url, { request: { headers } });
    });
  };

  switch (site.kind) {
    case "invalid":
      return withCsp(new NextResponse("Unknown host", { status: 400 }), csp);

    case "platform": {
      if (CONSOLE_PATH_RE.test(rest)) return withCsp(await renderConsole(), csp);
      const { redirect, locale } = withLocale();
      if (redirect) return withCsp(redirect, csp);
      requestHeaders.set("x-site-area", "platform");
      return withCsp(rewrite(`/site/${locale}${rest}`, locale), csp);
    }

    case "console":
      return withCsp(await renderConsole(), csp);

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

  await supabase.auth.getClaims();

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
    "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
