/**
 * Image preparation: size/format probing and normalization for OCR and
 * vision. Uses `sharp` (already installed for Next's image optimization)
 * when it can be loaded; without it, only the header probe runs and the
 * original bytes are used as-is.
 */
export type PreparedImage = {
  width: number;
  height: number;
  format: "jpeg" | "png" | "webp" | "gif" | "other";
  /** Grayscale PNG, long edge ≤ 2400px — the OCR input. */
  ocr: Buffer | null;
  /** JPEG, long edge ≤ 1600px — the vision-model input (fewer tokens, still legible). */
  vision: { data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" } | null;
};

type SharpFn = (input: Buffer, options?: { limitInputPixels?: number; failOn?: string }) => {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  rotate(): ReturnType<SharpFn>;
  resize(o: { width?: number; height?: number; fit?: string; withoutEnlargement?: boolean }): ReturnType<SharpFn>;
  grayscale(): ReturnType<SharpFn>;
  png(): ReturnType<SharpFn>;
  jpeg(o?: { quality?: number }): ReturnType<SharpFn>;
  toBuffer(): Promise<Buffer>;
};

let sharpLoader: Promise<SharpFn | null> | null = null;
function loadSharp(): Promise<SharpFn | null> {
  sharpLoader ??= import("sharp").then((m) => (m.default ?? m) as unknown as SharpFn).catch(() => null);
  return sharpLoader;
}

const MAX_PIXELS = 40_000_000; // refuse decompression bombs

export async function prepareImage(bytes: Uint8Array): Promise<PreparedImage | null> {
  const buf = Buffer.from(bytes);
  const probe = probeImageSize(buf);
  const sharp = await loadSharp();
  if (!sharp) {
    if (!probe) return null;
    const mediaType = probe.format === "png" ? "image/png" : probe.format === "webp" ? "image/webp" : probe.format === "jpeg" ? "image/jpeg" : null;
    return {
      ...probe,
      ocr: probe.format === "png" || probe.format === "jpeg" ? buf : null,
      vision: mediaType && buf.byteLength <= 4_000_000 ? { data: buf, mediaType } : null,
    };
  }
  try {
    const meta = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return null;
    const longEdge = Math.max(meta.width, meta.height);
    // Small images get a modest upscale for OCR; large ones are capped. Contrast
    // stretching was measured to *hurt* Tesseract on clean menus, so it's grayscale only.
    const ocrEdge = longEdge < 900 ? Math.round(longEdge * 1.5) : Math.min(longEdge, 2400);
    const fit = (edge: number) => (meta.width! >= meta.height! ? { width: edge } : { height: edge });
    const ocr = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "none" }).rotate().resize({ ...fit(ocrEdge), fit: "inside" }).grayscale().png().toBuffer();
    const vision = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "none" })
      .rotate()
      .resize({ ...fit(1600), fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const format = meta.format === "jpeg" || meta.format === "png" || meta.format === "webp" || meta.format === "gif" ? meta.format : "other";
    return { width: meta.width, height: meta.height, format, ocr, vision: { data: vision, mediaType: "image/jpeg" } };
  } catch {
    return null;
  }
}

/** Width/height/format from the file header alone (PNG, JPEG, WebP, GIF). */
export function probeImageSize(b: Buffer): { width: number; height: number; format: PreparedImage["format"] } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: "png" };
  if (b.length >= 10 && b.toString("ascii", 0, 3) === "GIF") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), format: "gif" };
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, format: "webp" };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
    }
    if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), format: "webp" };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), format: "jpeg" };
      }
      i += 2 + len;
    }
  }
  return null;
}
