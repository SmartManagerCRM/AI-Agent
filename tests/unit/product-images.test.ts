import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { productImageUrl } from "@/lib/product-image";
import type { SafeFetchResult } from "@/server/brain/safe-fetch";
import {
  attachProductImages,
  downloadImage,
  normalizeImage,
  sniffImage,
  storeProductImage,
  type StorageWriter,
} from "@/server/catalog/product-images";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

const TENANT = "11111111-1111-4111-8111-111111111111";
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";

const png = (w = 640, h = 480) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toBuffer();

/** In-memory bucket. */
function memoryStorage(failUpload = false) {
  const files = new Map<string, Buffer>();
  const storage: StorageWriter = {
    async upload(path, data) {
      if (failUpload) return false;
      files.set(path, data);
      return true;
    },
    async remove(paths) {
      for (const p of paths) files.delete(p);
    },
  };
  return { files, storage };
}

/**
 * The caller's session, reduced to what storeProductImage uses: read one
 * product, update it. `canWrite: false` behaves like RLS denying the
 * update (0 rows changed).
 */
function fakeSession(rows: Record<string, { image_path: string | null }>, canWrite = true) {
  const updates: Record<string, unknown>[] = [];
  const from = () => {
    const filters: Record<string, string> = {};
    let patch: Record<string, unknown> | null = null;
    const q = {
      select: () => q,
      update: (p: Record<string, unknown>) => ((patch = p), q),
      eq: (col: string, v: string) => ((filters[col] = v), q),
      maybeSingle: async () => ({ data: filters.tenant_id === TENANT && rows[filters.id] ? { ...rows[filters.id] } : null }),
      then: (resolve: (r: { data: { id: string }[] }) => void) => {
        const row = filters.tenant_id === TENANT ? rows[filters.id] : undefined;
        if (patch && row && canWrite) {
          Object.assign(row, patch);
          updates.push({ id: filters.id, ...patch });
          return resolve({ data: [{ id: filters.id }] });
        }
        return resolve({ data: [] });
      },
    };
    return q;
  };
  return { client: { from } as unknown as TypedSupabaseClient, updates };
}

describe("product photos: only real images, re-encoded", () => {
  it("recognises images by their bytes, not their name", async () => {
    expect(sniffImage(await png())).toBe("png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpeg");
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
  });

  it("stores a resized WebP (≤ 1000 px), never the original file", async () => {
    const out = await normalizeImage(await png(3000, 1500));
    expect(out?.contentType).toBe("image/webp");
    const meta = await sharp(out!.data).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(1000);
  });

  it("refuses non-images, SVG, and tiny icons / tracking pixels", async () => {
    expect(await normalizeImage(Buffer.from("<svg></svg>"))).toBeNull();
    expect(await normalizeImage(Buffer.from("not an image at all"))).toBeNull();
    expect(await normalizeImage(await png(16, 16))).toBeNull();
  });

  it("reads inline data-URI pictures; refuses other schemes", async () => {
    const b64 = (await png()).toString("base64");
    expect((await downloadImage(`data:image/png;base64,${b64}`))?.byteLength).toBeGreaterThan(100);
    expect(await downloadImage("file:///etc/passwd")).toBeNull();
    expect(await downloadImage("data:text/html;base64,PGgxPg==")).toBeNull();
  });

  it("public URL points at our own bucket", () => {
    expect(productImageUrl(`${TENANT}/${P1}-abc.webp`)).toBe(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}`.replace(/\/+$/, "") === ""
        ? null
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/public/catalog-images/${TENANT}/${P1}-abc.webp`,
    );
    expect(productImageUrl(null)).toBeNull();
  });
});

describe("product photos: storing and linking", () => {
  it("stores under the business's own folder and links the product", async () => {
    const { files, storage } = memoryStorage();
    const rows = { [P1]: { image_path: null as string | null } };
    const { client } = fakeSession(rows);
    expect(await storeProductImage(client, storage, TENANT, P1, await png(), "https://cdn.example.com/a.jpg")).toBe(true);
    expect(rows[P1].image_path).toMatch(new RegExp(`^${TENANT}/${P1}-[0-9a-f]{16}\\.webp$`));
    expect([...files.keys()]).toEqual([rows[P1].image_path]);
  });

  it("a user who may not edit the product changes nothing — the stored file is removed again", async () => {
    const { files, storage } = memoryStorage();
    const { client, updates } = fakeSession({ [P1]: { image_path: null } }, false);
    expect(await storeProductImage(client, storage, TENANT, P1, await png(), null)).toBe(false);
    expect(updates).toEqual([]);
    expect(files.size).toBe(0);
  });

  it("another business's product is never touched", async () => {
    const { files, storage } = memoryStorage();
    const { client } = fakeSession({});
    expect(await storeProductImage(client, storage, TENANT, P2, await png(), null)).toBe(false);
    expect(files.size).toBe(0);
  });

  it("replacing a photo removes the old file", async () => {
    const { files, storage } = memoryStorage();
    const rows = { [P1]: { image_path: null as string | null } };
    const { client } = fakeSession(rows);
    await storeProductImage(client, storage, TENANT, P1, await png(), null);
    const first = rows[P1].image_path;
    await storeProductImage(client, storage, TENANT, P1, await png(800, 800), null);
    expect(rows[P1].image_path).not.toBe(first);
    expect([...files.keys()]).toEqual([rows[P1].image_path]);
  });

  it("many products: one download per picture, failures counted, never stored", async () => {
    const { storage } = memoryStorage();
    const rows = { [P1]: { image_path: null as string | null }, [P2]: { image_path: null as string | null } };
    const { client } = fakeSession(rows);
    const bytes = await png();
    const asked: string[] = [];
    const fetcher = async (url: URL): Promise<SafeFetchResult> => {
      asked.push(url.toString());
      if (url.pathname.endsWith("broken.jpg")) {
        return { ok: true, url, status: 200, contentType: "image/jpeg", body: "", bytes: 9, truncated: false, data: new Uint8Array(Buffer.from("<html>404")) };
      }
      return { ok: true, url, status: 200, contentType: "image/png", body: "", bytes: bytes.byteLength, truncated: false, data: new Uint8Array(bytes) };
    };
    const result = await attachProductImages(
      client,
      storage,
      TENANT,
      [
        { productId: P1, imageUrl: "https://cdn.example.com/same.png" },
        { productId: P2, imageUrl: "https://cdn.example.com/same.png" },
        { productId: P2, imageUrl: "https://cdn.example.com/broken.jpg" },
      ],
      { fetcher: fetcher as never, concurrency: 1 },
    );
    expect(result).toEqual({ attached: 2, failed: 1, skipped: 0 });
    expect(asked.filter((u) => u.endsWith("same.png"))).toHaveLength(1);
  });
});
