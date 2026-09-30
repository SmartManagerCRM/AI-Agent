import { copyFile, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Local OCR (Tesseract, via tesseract.js) — the free first attempt at
 * reading a menu image. Language data for Arabic, English and French ships
 * with the app (npm `@tesseract.js-data/*`), so nothing is downloaded at
 * run time. One engine per ingestion job, used sequentially, terminated at
 * the end; a process-wide slot keeps concurrent jobs from each loading
 * their own engine on a small server.
 */
export const OCR_VERSION = "tesseract-5-best_int";
export const OCR_LANGS = ["eng", "ara", "fra"] as const;
const PER_IMAGE_TIMEOUT_MS = 30_000;

export type OcrLine = { text: string; confidence: number };
export type OcrResult = {
  text: string;
  lines: OcrLine[];
  /** Mean word confidence, 0–100. */
  confidence: number;
  /** Share of letters that are Arabic / Latin — mixed scripts are sent on to vision. */
  arabicShare: number;
  latinShare: number;
  ms: number;
};

type Worker = {
  recognize(image: Buffer, options?: object, output?: object): Promise<{ data: { text: string; confidence: number; blocks?: Block[] | null } }>;
  terminate(): Promise<unknown>;
};
type Block = { paragraphs?: { lines?: { text: string; confidence: number }[] }[] };

let slotBusy: Promise<void> = Promise.resolve();

export async function withOcrEngine<T>(work: (engine: OcrEngine) => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = slotBusy;
  slotBusy = new Promise<void>((resolve) => (release = resolve));
  await previous;
  const engine = new OcrEngine();
  try {
    return await work(engine);
  } finally {
    await engine.close();
    release();
  }
}

export class OcrEngine {
  private worker: Promise<Worker> | null = null;
  private failed = false;

  private async start(): Promise<Worker> {
    const langPath = await ensureLangData();
    const { createWorker, OEM } = await import("tesseract.js");
    const worker = (await createWorker([...OCR_LANGS], OEM.LSTM_ONLY, {
      langPath,
      cachePath: path.join(langPath, "cache"),
      gzip: true,
      logger: () => {},
      errorHandler: () => {},
    })) as unknown as Worker;
    return worker;
  }

  /** Null when OCR is unavailable (engine failed to load) or timed out — the caller moves on to vision. */
  async recognize(image: Buffer): Promise<OcrResult | null> {
    if (this.failed) return null;
    this.worker ??= this.start();
    const started = Date.now();
    try {
      const worker = await this.worker;
      const result = await Promise.race([
        worker.recognize(image, {}, { text: true, blocks: true }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), PER_IMAGE_TIMEOUT_MS)),
      ]);
      if (!result) {
        await this.close(); // a stuck engine is discarded; the next image gets a fresh one
        return null;
      }
      return summarize(result.data, Date.now() - started);
    } catch {
      this.failed = true;
      return null;
    }
  }

  async close() {
    const w = this.worker;
    this.worker = null;
    if (w) await w.then((x) => x.terminate()).catch(() => undefined);
  }
}

export function summarize(data: { text: string; confidence: number; blocks?: Block[] | null }, ms: number): OcrResult {
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) for (const p of block.paragraphs ?? []) for (const l of p.lines ?? []) {
    const text = l.text.replace(/\s+/g, " ").trim();
    if (text) lines.push({ text, confidence: l.confidence });
  }
  if (lines.length === 0) {
    for (const t of data.text.split("\n")) if (t.trim()) lines.push({ text: t.trim(), confidence: data.confidence });
  }
  const letters = data.text.replace(/[^\p{L}]/gu, "");
  const arabic = (letters.match(/[؀-ۿݐ-ݿﭐ-﻿]/g) ?? []).length;
  const latin = (letters.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  const total = Math.max(letters.length, 1);
  return { text: data.text, lines, confidence: data.confidence, arabicShare: arabic / total, latinShare: latin / total, ms };
}

/** Copies the bundled traineddata into one writable directory (tesseract.js wants all languages side by side). */
async function ensureLangData(): Promise<string> {
  const dir = path.join(os.tmpdir(), `smartmanager-tessdata-${OCR_VERSION}`);
  await mkdir(dir, { recursive: true });
  for (const lang of OCR_LANGS) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    const exists = await stat(target).then((s) => s.size > 0).catch(() => false);
    if (exists) continue;
    const source = path.join(process.cwd(), "node_modules", "@tesseract.js-data", lang, "4.0.0_best_int", `${lang}.traineddata.gz`);
    await copyFile(source, target);
  }
  return dir;
}
