/**
 * Which sidebar link is the current page: the one whose address is the
 * longest match for the URL. Every console page sits under the Dashboard's
 * own address (`/en/roasters-cafe/orders` starts with `/en/roasters-cafe`),
 * so "starts with" alone would keep Dashboard selected on every page —
 * only the most specific link is selected.
 */
export function activeNavHref(pathname: string | null | undefined, hrefs: readonly string[]): string | null {
  if (!pathname) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: string | null = null;
  for (const href of hrefs) {
    if ((path === href || path.startsWith(`${href}/`)) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
