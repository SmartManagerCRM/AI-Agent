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
 */
const INTERNAL_HEADERS = ["x-site-area", "x-next-intl-locale"];

export async function proxy(request: NextRequest) {
  const env = serverEnv();
  const site = classifyHost(request.headers.get("host"), {
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
  });

  const { pathname, search } = request.nextUrl;
  const { locale: pathLocale, rest } = splitLocaleFromPath(pathname);
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const acceptLanguage = request.headers.get("accept-language");

  const withLocale = () => {
    if (pathLocale) return { redirect: null, locale: pathLocale };
    const locale = negotiateLocale({ allowed: LOCALES, fallback: "en", cookie: cookieLocale, acceptLanguage });
    const target = `/${locale}${pathname === "/" ? "" : pathname}${search}`;
    return { redirect: sameHostRedirect(request, target, env.PUBLIC_URL_SCHEME), locale };
  };

  const requestHeaders = new Headers(request.headers);
  for (const header of INTERNAL_HEADERS) requestHeaders.delete(header);

  const rewrite = (internalPath: string, locale: Locale) => {
    requestHeaders.set("x-next-intl-locale", locale);
    const url = request.nextUrl.clone();
    url.pathname = internalPath;
    url.search = search;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  };

  switch (site.kind) {
    case "invalid":
      return new NextResponse("Unknown host", { status: 400 });

    case "platform": {
      const { redirect, locale } = withLocale();
      if (redirect) return redirect;
      requestHeaders.set("x-site-area", "platform");
      return rewrite(`/site/${locale}${rest}`, locale);
    }

    case "console": {
      const { redirect, locale } = withLocale();
      if (redirect) return redirect;
      requestHeaders.set("x-site-area", "console");
      return refreshSession(request, requestHeaders, (headers) => {
        headers.set("x-next-intl-locale", locale);
        const url = request.nextUrl.clone();
        url.pathname = `/console/${locale}${rest}`;
        return NextResponse.rewrite(url, { request: { headers } });
      });
    }

    case "agent": {
      const locale = negotiateLocale({ allowed: LOCALES, fallback: "en", cookie: cookieLocale, acceptLanguage });
      requestHeaders.set("x-site-area", "agent");
      return rewrite(`/agent${pathname === "/" ? "" : pathname}`, locale);
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
