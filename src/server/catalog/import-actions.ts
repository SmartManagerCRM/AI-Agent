"use server";

import { revalidatePath } from "next/cache";

import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { actionT } from "@/server/i18n/action-messages";

import { addCatalogItems, existingCatalogNames } from "./bulk";
import { attachProductImages, bucketWriter, type ImageAttachResult } from "./product-images";
import {
  extractItemsFromHtml,
  pageAddressOf,
  extractItemsFromLines,
  extractLinesFromPdf,
  prepareCatalogItems,
  type RawCatalogItem,
} from "./import-extract";

/**
 * "Add products from a file" — an HTML page or a PDF price list becomes
 * catalog products (or bookable services). Text is read straight from the
 * file and parsed by rules only: no AI model is called, so it costs
 * nothing. A PDF that is only a scanned picture has no text to read; the
 * owner is told so rather than sent through an AI step.
 */

export type ImportState =
  | {
      ok: boolean;
      message: string;
      added?: string[];
      needsPrice?: number;
      skipped?: { unpriced: number; duplicates: number; unreadable: number };
      /** Photos found with the items: stored, not downloadable, left for lack of time. */
      images?: ImageAttachResult;
      /** The file shows photos by relative path and says nothing about where it came from. */
      imagesUnreachable?: boolean;
    }
  | undefined;

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 60;
const MAX_ITEMS = 1000;

function decodeHtml(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export async function importCatalogFileAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const locale = String(formData.get("locale") ?? "");
  const t = await actionT(locale);
  const slug = String(formData.get("slug") ?? "");
  const kind = formData.get("kind") === "service" ? "service" : "product";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: t("catalog.chooseFile") };
  if (file.size > MAX_BYTES) return { ok: false, message: t("catalog.tooLarge") };

  const { tenant } = await requireTenantMember(locale, slug);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = new TextDecoder("latin1").decode(bytes.slice(0, 5)) === "%PDF-";
  const isHtml =
    !isPdf &&
    (/\.html?$/i.test(file.name) ||
      /html/i.test(file.type) ||
      /<\s*(html|body|table|div|p|ul)\b/i.test(decodeHtml(bytes.slice(0, 4096))));
  if (!isPdf && !isHtml)
    return { ok: false, message: t("catalog.notHtmlPdf") };

  let raw: RawCatalogItem[];
  let imagesUnreachable = false;
  try {
    if (isPdf) {
      const lines = await extractLinesFromPdf(bytes, MAX_PDF_PAGES);
      if (lines === null)
        return { ok: false, message: t("catalog.tooManyPages", { n: MAX_PDF_PAGES }) };
      if (lines.join("").replace(/\s/g, "").length < 10) {
        return {
          ok: false,
          message: t("catalog.scanned"),
        };
      }
      raw = extractItemsFromLines(lines);
    } else {
      const html = decodeHtml(bytes);
      raw = extractItemsFromHtml(html);
      imagesUnreachable = !pageAddressOf(html) && /<img\b[^>]*\bsrc=["'](?!https?:|data:)[^"']+/i.test(html);
    }
  } catch {
    return { ok: false, message: t("catalog.unreadable") };
  }

  const supabase = await createUserClient();
  const existingNames = await existingCatalogNames(supabase, tenant.id, kind, false);
  const prepared = prepareCatalogItems(raw.slice(0, MAX_ITEMS * 2), {
    tenantCurrency: tenant.currency,
    kind,
    existingNames,
  });
  const items = prepared.items.slice(0, MAX_ITEMS);
  if (items.length === 0) {
    return {
      ok: false,
      message:
        raw.length === 0 ? t(kind === "service" ? "catalog.noneFoundService" : "catalog.noneFoundProduct") : t("catalog.nothingNew"),
      skipped: prepared.skipped,
    };
  }

  const result = await addCatalogItems(supabase, tenant, items, { kind, source: "file_import", active: () => true });
  if (!result.ok) return { ok: false, message: t("catalog.addNoPermission") };

  // Each product's photo from the file: downloaded, checked, re-encoded and stored in our own bucket.
  const jobs = result.inserted.flatMap((i) => (i.imageUrl ? [{ productId: i.id, imageUrl: i.imageUrl }] : []));
  let images: ImageAttachResult | undefined;
  if (jobs.length > 0) {
    try {
      images = await attachProductImages(supabase, bucketWriter(serviceClient()), tenant.id, jobs, { budgetMs: 40_000 });
    } catch {
      images = { attached: 0, failed: jobs.length, skipped: 0 };
    }
  }
  revalidatePath(`/${locale}/${slug}/products`);
  revalidatePath(`/${locale}/${slug}/bookings`);
  revalidatePath(`/${locale}/${slug}`);
  return {
    ok: true,
    message: t(kind === "service" ? "catalog.importedServices" : "catalog.importedProducts", { n: result.added, file: file.name }),
    added: items.slice(0, 30).map((i) => i.name),
    needsPrice: items.filter((i) => i.sourcePrice).length,
    skipped: prepared.skipped,
    images,
    imagesUnreachable: imagesUnreachable && !images?.attached,
  };
}
