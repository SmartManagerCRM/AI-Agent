/**
 * Client-side slug suggestion from a business's display name — a starting
 * point the user can still edit. The server
 * (`createBusinessSchema` in `src/server/business/actions.ts`) is the
 * actual source of truth for what's accepted and enforces the same shape
 * independently, so this never needs to be perfect, only a good default.
 */
export function slugify(input: string): string {
  const withoutDiacritics = input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const slug = withoutDiacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  // Matches the server's max (see the `{0,46}` in createBusinessSchema's
  // slug regex: first char + up to 46 + last char = 48).
  return slug.slice(0, 48).replace(/-+$/g, "");
}
