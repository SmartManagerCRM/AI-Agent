// Generates the favicon and the installable-app (PWA) icons from the
// official SmartManager AI Agent logo:
//
//   node scripts/generate-pwa-icons.mjs [path/to/logo]
//
// The logo's white background is removed (flood fill from the corners),
// then the robot head — the most recognisable part at small sizes — is
// placed on the logo's own green. Outputs:
//   public/favicon.ico            16/32/48 px, round
//   public/icons/icon-{192,256,384,512}.png   rounded square (purpose "any")
//   public/icons/icon-180.png     opaque square for iOS (it rounds the corners itself)
//   public/icons/icon-512-maskable.png  full-bleed; the head stays inside the
//                                 central 80% safe zone so any launcher mask keeps it whole
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] ?? path.join(root, "assets/brand/smartmanager-ai-agent-logo.jpg");

// Crops of the (square) logo, as fractions: left, top, size. The app icons
// show the head and shoulders; the favicon zooms in on the head alone.
const HEAD = { left: 0.185, top: 0.075, size: 0.56 };
const FACE = { left: 0.235, top: 0.115, size: 0.46 };
// The speech bubble beside the head (cleared so it doesn't poke in at the edge).
const BUBBLE = { left: 0.695, bottom: 0.4 };

function background(n, shape) {
  const fill =
    shape === "circle"
      ? `<circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}" fill="url(#g)"/>`
      : shape === "rounded"
        ? `<rect width="${n}" height="${n}" rx="${n * 0.22}" fill="url(#g)"/>`
        : `<rect width="${n}" height="${n}" fill="url(#g)"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}">` +
      `<defs><linearGradient id="g" x1="0.7" y1="0" x2="0.2" y2="1">` +
      `<stop offset="0" stop-color="#015e3f"/><stop offset="1" stop-color="#01432e"/></linearGradient></defs>` +
      `${fill}</svg>`,
  );
}

/** The logo with its white background made transparent. */
async function cutout() {
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isWhite = (p) => data[p * 3] >= 244 && data[p * 3 + 1] >= 244 && data[p * 3 + 2] >= 244;
  const bg = new Uint8Array(w * h);
  const queue = [0, w - 1, (h - 1) * w, h * w - 1];
  for (const p of queue) bg[p] = 1;
  while (queue.length) {
    const p = queue.pop();
    const x = p % w;
    for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (n >= 0 && n < w * h && !bg[n] && isWhite(n)) {
        bg[n] = 1;
        queue.push(n);
      }
    }
  }
  // Pixels just inside the background's edge are anti-aliased against white;
  // un-mix the white out of them ("colour to alpha") so no light halo shows
  // when the artwork sits on green.
  let edge = bg;
  for (let i = 0; i < 4; i++) {
    const grown = edge.slice();
    for (let p = 0; p < w * h; p++) {
      if (edge[p]) continue;
      const x = p % w;
      if (
        (x > 0 && edge[p - 1]) ||
        (x < w - 1 && edge[p + 1]) ||
        (p >= w && edge[p - w]) ||
        (p + w < w * h && edge[p + w])
      )
        grown[p] = 1;
    }
    edge = grown;
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const [r, g, b] = [data[p * 3], data[p * 3 + 1], data[p * 3 + 2]];
    let alpha = 255;
    let rgb = [r, g, b];
    if (bg[p] || (p % w >= BUBBLE.left * w && p / w <= BUBBLE.bottom * h)) alpha = 0;
    else if (edge[p]) {
      const a = Math.max(255 - r, 255 - g, 255 - b) / 255;
      alpha = Math.round(a * 255);
      rgb = a > 0 ? [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round((c - (1 - a) * 255) / a)))) : [0, 0, 0];
    }
    rgba[p * 4] = rgb[0];
    rgba[p * 4 + 1] = rgb[1];
    rgba[p * 4 + 2] = rgb[2];
    rgba[p * 4 + 3] = alpha;
  }
  const size = Math.min(w, h);
  return { image: sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png(), size };
}

async function icon(logo, n, { shape, scale, crop = HEAD, bottom = false }) {
  const inner = Math.round(n * scale);
  const box = {
    left: Math.round(crop.left * logo.size),
    top: Math.round(crop.top * logo.size),
    width: Math.round(crop.size * logo.size),
    height: Math.round(crop.size * logo.size),
  };
  const art = await logo.image.clone().extract(box).resize(inner, inner, { kernel: "lanczos3" }).png().toBuffer();
  const offset = Math.round((n - inner) / 2);
  let out = await sharp(background(n, shape))
    // Shoulders run off the bottom edge, as in the full-bleed icons.
    .composite([{ input: art, left: offset, top: bottom ? n - inner : offset }])
    .png()
    .toBuffer();
  if (shape !== "square") {
    // Clip the artwork to the rounded/circular background.
    out = await sharp(out)
      .composite([{ input: await sharp(background(n, shape)).png().toBuffer(), blend: "dest-in" }])
      .png()
      .toBuffer();
  }
  return sharp(out).png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }).toBuffer();
}

/** A .ico holding PNG images (supported by every current browser). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const logo = await cutout();
const icons = path.join(root, "public/icons");
await mkdir(icons, { recursive: true });

for (const n of [192, 256, 384, 512]) {
  await writeFile(path.join(icons, `icon-${n}.png`), await icon(logo, n, { shape: "rounded", scale: 1 }));
}
await writeFile(path.join(icons, "icon-180.png"), await icon(logo, 180, { shape: "square", scale: 1 }));
await writeFile(
  path.join(icons, "icon-512-maskable.png"),
  await icon(logo, 512, { shape: "square", scale: 0.74, bottom: true }),
);

const favicons = [];
for (const size of [16, 32, 48]) {
  // Render large, then downscale: sharper than resizing the logo straight to 16 px.
  const big = await icon(logo, 256, { shape: "circle", scale: 1, crop: size === 48 ? HEAD : FACE });
  favicons.push({ size, data: await sharp(big).resize(size, size, { kernel: "lanczos3" }).png().toBuffer() });
}
await writeFile(path.join(root, "public/favicon.ico"), ico(favicons));
console.log("icons written");
