"use server";

import { revalidatePath } from "next/cache";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

import { addCatalogItems, existingCatalogNames } from "./bulk";
import {
  extractItemsFromHtml,
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
      skipped?: { unpriced: number; otherCurrency: number; duplicates: number; unreadable: number };
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
  const slug = String(formData.get("slug") ?? "");
  const kind = formData.get("kind") === "service" ? "service" : "product";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an HTML or PDF file first." };
  if (file.size > MAX_BYTES) return { ok: false, message: "The file is too large — keep it under 8 MB." };

  const { tenant } = await requireTenantMember(locale, slug);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = new TextDecoder("latin1").decode(bytes.slice(0, 5)) === "%PDF-";
  const isHtml =
    !isPdf &&
    (/\.html?$/i.test(file.name) ||
      /html/i.test(file.type) ||
      /<\s*(html|body|table|div|p|ul)\b/i.test(decodeHtml(bytes.slice(0, 4096))));
  if (!isPdf && !isHtml)
    return { ok: false, message: "That file isn't HTML or PDF — save your price list as a web page (.html) or a PDF." };

  let raw: RawCatalogItem[];
  try {
    if (isPdf) {
      const lines = await extractLinesFromPdf(bytes, MAX_PDF_PAGES);
      if (lines === null)
        return { ok: false, message: `That PDF has more than ${MAX_PDF_PAGES} pages — split it and import the parts.` };
      if (lines.join("").replace(/\s/g, "").length < 10) {
        return {
          ok: false,
          message:
            "This PDF has no selectable text — it looks like a scanned picture. Export it as a text PDF (or save the page as HTML) and try again.",
        };
      }
      raw = extractItemsFromLines(lines);
    } else {
      raw = extractItemsFromHtml(decodeHtml(bytes));
    }
  } catch {
    return { ok: false, message: "That file couldn't be read — it may be damaged or password-protected." };
  }

  const supabase = await createUserClient();
  const existingNames = await existingCatalogNames(supabase, tenant.id, kind, false);
  const prepared = prepareCatalogItems(raw.slice(0, MAX_ITEMS * 2), {
    tenantCurrency: tenant.currency,
    kind,
    existingNames,
  });
  const items = prepared.items.slice(0, MAX_ITEMS);
  const noun = kind === "service" ? "service" : "product";
  if (items.length === 0) {
    return {
      ok: false,
      message:
        raw.length === 0
          ? `No ${noun}s with prices were found in that file. Each line should read like “Spanish Latte … 18”.`
          : `Nothing new to add — every ${noun} found was already in your catalog or couldn't be used.`,
      skipped: prepared.skipped,
    };
  }

  const result = await addCatalogItems(supabase, tenant, items, { kind, source: "file_import", active: () => true });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/${locale}/${slug}/products`);
  revalidatePath(`/${locale}/${slug}/bookings`);
  revalidatePath(`/${locale}/${slug}`);
  return {
    ok: true,
    message: `${result.added} ${noun}${result.added === 1 ? "" : "s"} added from ${file.name}.`,
    added: items.slice(0, 30).map((i) => i.name),
    skipped: prepared.skipped,
  };
}
