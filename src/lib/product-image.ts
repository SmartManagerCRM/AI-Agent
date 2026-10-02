/** Supabase Storage bucket holding catalog photos (public read; written only by the server). */
export const PRODUCT_IMAGE_BUCKET = "catalog-images";

/** Public URL of a stored product photo, or null when the product has none. */
export function productImageUrl(path: string | null | undefined): string | null {
  // Referenced literally so Next.js inlines it in client bundles.
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!path || !base) return null;
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
