"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { draftBrainCatalog } from "@/server/catalog/brain-drafts";
import { bucketWriter, storeProductImage } from "@/server/catalog/product-images";
import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const createBranchSchema = z.object({
  tenantId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  isDefault: z.enum(["on"]).optional(),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function createBranchAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createBranchSchema.safeParse({
    tenantId: formData.get("tenantId"),
    name: formData.get("name"),
    phone: formData.get("phone"),
    isDefault: formData.get("isDefault") ?? undefined,
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();

  if (parsed.data.isDefault === "on") {
    await supabase.from("branches").update({ is_default: false }).eq("tenant_id", parsed.data.tenantId);
  }

  const { error } = await supabase.from("branches").insert({
    tenant_id: parsed.data.tenantId,
    name: { [parsed.data.locale]: parsed.data.name },
    phone: parsed.data.phone || null,
    is_default: parsed.data.isDefault === "on",
  });
  if (error) return "VALIDATION_ERROR: could not create that branch — please try again.";

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/branches`);
}

const createCategorySchema = z.object({
  tenantId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function createCategoryAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createCategorySchema.safeParse({
    tenantId: formData.get("tenantId"),
    name: formData.get("name"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("categories")
    .insert({ tenant_id: parsed.data.tenantId, name: { [parsed.data.locale]: parsed.data.name } });
  if (error) return "VALIDATION_ERROR: could not create that category — please try again.";

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/products`);
}

const createProductSchema = z.object({
  tenantId: z.uuid(),
  categoryId: z.uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1).max(160),
  priceMajor: z.coerce.number().min(0).max(1_000_000),
  currencyExponent: z.coerce.number().int().min(0).max(3),
  status: z.enum(["draft", "active"]),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function createProductAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createProductSchema.safeParse({
    tenantId: formData.get("tenantId"),
    categoryId: formData.get("categoryId") ?? undefined,
    name: formData.get("name"),
    priceMajor: formData.get("priceMajor"),
    currencyExponent: formData.get("currencyExponent"),
    status: formData.get("status"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const priceMinor = Math.round(parsed.data.priceMajor * 10 ** parsed.data.currencyExponent);

  const { error } = await supabase.from("products").insert({
    tenant_id: parsed.data.tenantId,
    category_id: parsed.data.categoryId || null,
    name: { [parsed.data.locale]: parsed.data.name },
    price_minor: priceMinor,
    status: parsed.data.status,
  });
  if (error) return "VALIDATION_ERROR: could not create that product — please try again.";

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/products`);
}

const productStatusSchema = z.object({
  productId: z.uuid().optional(),
  status: z.enum(["active", "draft", "suspended"]),
  locale: z.string(),
  slug: z.string().min(1),
});

/**
 * Put a product on sale (active), take it off sale (suspended) or back to
 * draft. Drafts and suspended products are never shown to customers.
 * Without a `productId`, every draft of the business is activated at once
 * — except drafts that still need the owner's price (found in another
 * currency), which the database never lets go live. RLS (`catalog.write`)
 * decides who may.
 */
export async function setProductStatusAction(formData: FormData): Promise<void> {
  const parsed = productStatusSchema.safeParse({
    productId: formData.get("productId") || undefined,
    status: formData.get("status"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const update = supabase
    .from("products")
    .update({ status: parsed.data.status })
    .eq("tenant_id", tenant.id)
    .neq("status", "archived");
  if (parsed.data.productId) await update.eq("id", parsed.data.productId);
  else if (parsed.data.status === "active") await update.eq("status", "draft").is("source_price", null);
  revalidateCatalog(parsed.data.locale, parsed.data.slug);
}

const productIdSchema = z.object({ productId: z.uuid(), locale: z.string(), slug: z.string().min(1) });

/**
 * Delete a product: it leaves the catalog and the Agent at once. The row is
 * kept as `archived` so past orders still show what was sold, and so the
 * Business Brain or a file import never adds it back.
 */
export async function deleteProductAction(formData: FormData): Promise<void> {
  const parsed = productIdSchema.safeParse({
    productId: formData.get("productId"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("products")
    .update({ status: "archived" })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.productId);
  revalidateCatalog(parsed.data.locale, parsed.data.slug);
}

const updateProductSchema = z.object({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  priceMajor: z.coerce.number().min(0).max(1_000_000),
  categoryId: z.uuid().optional().or(z.literal("")),
  description: z.string().trim().max(2000),
  locale: z.string(),
  slug: z.string().min(1),
});

export type ProductEditState = { ok: boolean; message: string } | undefined;

/**
 * Edit a product's name, price, category and description. The name and
 * description shown in the console's language are replaced; other
 * translations are kept. Saving a price confirms it — a draft that was
 * waiting for the owner's price (found in another currency) can then go on
 * sale.
 */
export async function updateProductAction(_prev: ProductEditState, formData: FormData): Promise<ProductEditState> {
  const parsed = updateProductSchema.safeParse({
    productId: formData.get("productId"),
    name: formData.get("name"),
    priceMajor: formData.get("priceMajor"),
    categoryId: formData.get("categoryId") ?? "",
    description: formData.get("description") ?? "",
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const { locale, slug } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const [{ data: product }, { data: currency }] = await Promise.all([
    supabase
      .from("products")
      .select("name, description")
      .eq("tenant_id", tenant.id)
      .eq("id", parsed.data.productId)
      .neq("status", "archived")
      .maybeSingle(),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);
  if (!product) return { ok: false, message: "That product no longer exists — reload the page." };

  const exponent = currency?.exponent ?? 2;
  const shownKey = (text: Record<string, string>) => (locale in text ? locale : (Object.keys(text)[0] ?? locale));
  const name = { ...product.name, [shownKey(product.name)]: parsed.data.name };
  const description = { ...product.description };
  const descriptionKey = shownKey(Object.keys(description).length > 0 ? description : product.name);
  if (parsed.data.description) description[descriptionKey] = parsed.data.description;
  else delete description[descriptionKey];

  const { error } = await supabase
    .from("products")
    .update({
      name,
      description,
      price_minor: Math.round(parsed.data.priceMajor * 10 ** exponent),
      category_id: parsed.data.categoryId || null,
      source_price: null,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.productId);
  if (error) return { ok: false, message: "Couldn't save — you need permission to edit products." };

  const photo = savedPhoto(formData.get("photo"));
  if (photo === "too_large") {
    revalidateCatalog(locale, slug);
    return { ok: false, message: "Saved — but that photo is larger than 6 MB. Choose a smaller one." };
  }
  if (photo || formData.get("removePhoto") === "on") {
    let storage;
    try {
      storage = bucketWriter(serviceClient());
    } catch {
      revalidateCatalog(locale, slug);
      return { ok: false, message: "Saved — but photos can't be stored on this server yet (storage isn't configured)." };
    }
    if (photo) {
      const stored = await storeProductImage(
        supabase,
        storage,
        tenant.id,
        parsed.data.productId,
        new Uint8Array(await photo.arrayBuffer()),
        null,
      ).catch(() => false);
      if (!stored) {
        revalidateCatalog(locale, slug);
        return { ok: false, message: "Saved — but that photo couldn't be used. Upload a JPG, PNG or WebP picture." };
      }
    } else {
      const { data: current } = await supabase
        .from("products")
        .select("image_path")
        .eq("tenant_id", tenant.id)
        .eq("id", parsed.data.productId)
        .maybeSingle();
      const { data: cleared } = await supabase
        .from("products")
        .update({ image_path: null, image_source_url: null })
        .eq("tenant_id", tenant.id)
        .eq("id", parsed.data.productId)
        .select("id");
      if (cleared?.length && current?.image_path) await storage.remove([current.image_path]);
    }
  }
  revalidateCatalog(locale, slug);
  return { ok: true, message: "Saved." };
}

const MAX_PHOTO_BYTES = 6_000_000;

/** The uploaded photo file, if one was chosen. */
function savedPhoto(value: FormDataEntryValue | null): File | "too_large" | null {
  if (!(value instanceof File) || value.size === 0) return null;
  return value.size > MAX_PHOTO_BYTES ? "too_large" : value;
}

export type BrainSyncState = { ok: boolean; message: string } | undefined;

/**
 * "Add from Business Brain": puts every product and service the Brain found
 * that isn't in the catalog yet onto these pages now (drafts until approved
 * in the Brain; approved ones active). Safe to press any time — nothing is
 * added twice and deleted items are not added back.
 */
export async function syncBrainCatalogAction(_prev: BrainSyncState, formData: FormData): Promise<BrainSyncState> {
  const locale = String(formData.get("locale") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  let storage;
  try {
    storage = bucketWriter(serviceClient());
  } catch {
    storage = undefined; // no secret key configured: products are still added, without photos
  }
  const result = await draftBrainCatalog(supabase, tenant, { storage }).catch(() => null);
  if (!result || result.failed) {
    return { ok: false, message: "Couldn't add to your catalog — you need permission to edit products." };
  }
  revalidateCatalog(locale, slug);
  const photos =
    result.images.attached > 0
      ? ` ${result.images.attached} photo${result.images.attached === 1 ? "" : "s"} added.`
      : "";
  const photoTrouble = result.images.failed > 0 ? ` ${result.images.failed} photo(s) couldn't be downloaded.` : "";
  if (result.products + result.services === 0) {
    return { ok: true, message: `Everything the Business Brain found is already here.${photos}${photoTrouble}` };
  }
  const parts = [
    result.products > 0 ? `${result.products} product${result.products === 1 ? "" : "s"}` : null,
    result.services > 0 ? `${result.services} service${result.services === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return {
    ok: true,
    message:
      `Added ${parts.join(" and ")} from the Business Brain.` +
      (result.needsPrice > 0
        ? ` ${result.needsPrice} ${result.needsPrice === 1 ? "was" : "were"} priced in another currency — set your price on each (pencil icon) before it can go on sale.`
        : "") +
      photos +
      photoTrouble,
  };
}

function revalidateCatalog(locale: string, slug: string) {
  revalidatePath(`/${locale}/${slug}/products`);
  revalidatePath(`/${locale}/${slug}/bookings`);
  revalidatePath(`/${locale}/${slug}`);
}
