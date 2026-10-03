import "server-only";

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ContentLang, ServiceOutcome } from "./types";

/**
 * Last resort when no translation service is available: open-source
 * translation models (OPUS-MT, Helsinki-NLP) run on this server with
 * transformers.js — no account, no per-character cost, no AI.
 *
 * They run in a separate Node process: the models need far more memory than
 * a web request, and if that process runs out of memory or crashes, only it
 * goes — the app keeps serving. It starts on first use, downloads each model
 * once (from Hugging Face, into the server's temp directory), and quits after
 * a few idle minutes to give the memory back. It is given no secrets.
 *
 * Arabic ↔ French goes through English (no direct model).
 * `TRANSLATION_LOCAL_MODELS=off` turns it off (e.g. a server too small for it).
 */
export const LOCAL_MODELS: Record<string, string> = {
  "en-ar": "Xenova/opus-mt-en-ar",
  "ar-en": "Xenova/opus-mt-ar-en",
  "en-fr": "Xenova/opus-mt-en-fr",
  "fr-en": "Xenova/opus-mt-fr-en",
};

const IDLE_MS = 3 * 60_000;
/** The first request may download the models. */
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const MEMORY_MB = 1536;

const WORKER_SOURCE = `
import readline from "node:readline";
const { pipeline, env } = await import("@huggingface/transformers");
env.cacheDir = process.env.TRANSLATION_MODELS_DIR;
env.allowLocalModels = false;
const MODELS = JSON.parse(process.env.TRANSLATION_MODELS);
const loaded = new Map();
const model = (pair) => {
  if (!loaded.has(pair)) loaded.set(pair, pipeline("translation", MODELS[pair], { dtype: "q8" }));
  return loaded.get(pair);
};
async function translate(from, to, texts) {
  if (from !== "en" && to !== "en") return translate("en", to, await translate(from, "en", texts));
  const run = await model(from + "-" + to);
  const out = [];
  for (const text of texts) {
    const result = await run(text, { max_new_tokens: 400 });
    out.push(String(result?.[0]?.translation_text ?? "").trim());
  }
  return out;
}
const rl = readline.createInterface({ input: process.stdin });
let queue = Promise.resolve();
rl.on("line", (line) => {
  queue = queue.then(async () => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    try {
      const texts = await translate(request.from, request.to, request.texts);
      process.stdout.write(JSON.stringify({ id: request.id, ok: true, texts }) + "\\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: String(error?.message ?? error).slice(0, 300) }) + "\\n");
    }
  });
});
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
`;

/** The directory whose node_modules holds transformers.js (the project root, also from a standalone build), or null. */
export function findModelRuntimeRoot(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, "node_modules", "@huggingface", "transformers", "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

type Pending = { resolve: (outcome: ServiceOutcome) => void; timer: NodeJS.Timeout };
type Worker = { child: ChildProcess; pending: Map<number, Pending>; buffer: string; ready: Promise<boolean> };

// The one model process of this server (not business data: models and a request counter).
let worker: Worker | null = null;
let nextId = 1;
let idleTimer: NodeJS.Timeout | null = null;
/** Set when the runtime is missing or the process can't start: don't retry for a while. */
let unavailableUntil = 0;

export function localModelsEnabled(): boolean {
  return process.env.TRANSLATION_LOCAL_MODELS !== "off" && Date.now() >= unavailableUntil;
}

function stopWorker(reason: ServiceOutcome) {
  const w = worker;
  worker = null;
  if (!w) return;
  for (const p of w.pending.values()) {
    clearTimeout(p.timer);
    p.resolve(reason);
  }
  w.pending.clear();
  w.child.kill();
}

function startWorker(root: string): Worker {
  const child = spawn(process.execPath, [`--max-old-space-size=${MEMORY_MB}`, "--input-type=module", "-e", WORKER_SOURCE], {
    cwd: root,
    stdio: ["pipe", "pipe", "ignore"],
    // Only what the model process needs: no keys, no database credentials.
    env: {
      NODE_ENV: "production",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? os.tmpdir(),
      TRANSLATION_MODELS_DIR: path.join(os.tmpdir(), "smartmanager-translation-models"),
      TRANSLATION_MODELS: JSON.stringify(LOCAL_MODELS),
    },
  });
  const w: Worker = { child, pending: new Map(), buffer: "", ready: Promise.resolve(false) };
  w.ready = new Promise<boolean>((resolve) => {
    const giveUp = setTimeout(() => resolve(false), 60_000);
    child.stdout!.on("data", (chunk: Buffer) => {
      w.buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = w.buffer.indexOf("\n")) >= 0) {
        const line = w.buffer.slice(0, nl);
        w.buffer = w.buffer.slice(nl + 1);
        let msg: { ready?: boolean; id?: number; ok?: boolean; texts?: string[] };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready) {
          clearTimeout(giveUp);
          resolve(true);
          continue;
        }
        const p = msg.id !== undefined ? w.pending.get(msg.id) : undefined;
        if (!p) continue;
        w.pending.delete(msg.id!);
        clearTimeout(p.timer);
        p.resolve(msg.ok && Array.isArray(msg.texts) ? { ok: true, texts: msg.texts } : { ok: false, reason: "failed" });
      }
    });
    child.on("exit", () => {
      clearTimeout(giveUp);
      resolve(false);
      if (worker?.child === child) stopWorker({ ok: false, reason: "failed" });
    });
    child.on("error", () => {
      clearTimeout(giveUp);
      resolve(false);
    });
  });
  return w;
}

/** Translates with the local models; "unavailable" when they can't run on this server. */
export async function localTranslate(texts: string[], from: ContentLang, to: ContentLang): Promise<ServiceOutcome> {
  if (!localModelsEnabled()) return { ok: false, reason: "unavailable" };
  const root = findModelRuntimeRoot();
  if (!root) {
    unavailableUntil = Date.now() + 60 * 60_000;
    return { ok: false, reason: "unavailable" };
  }
  if (!worker) worker = startWorker(root);
  const w = worker;
  if (!(await w.ready)) {
    unavailableUntil = Date.now() + 15 * 60_000;
    stopWorker({ ok: false, reason: "unavailable" });
    return { ok: false, reason: "unavailable" };
  }
  if (idleTimer) clearTimeout(idleTimer);
  const outcome = await new Promise<ServiceOutcome>((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      w.pending.delete(id);
      resolve({ ok: false, reason: "failed" });
    }, REQUEST_TIMEOUT_MS);
    w.pending.set(id, { resolve, timer });
    w.child.stdin!.write(JSON.stringify({ id, from, to, texts }) + "\n");
  });
  idleTimer = setTimeout(() => {
    if (worker && worker.pending.size === 0) stopWorker({ ok: false, reason: "failed" });
  }, IDLE_MS);
  idleTimer.unref();
  if (outcome.ok && (outcome.texts.length !== texts.length || outcome.texts.some((t) => !t))) return { ok: false, reason: "failed" };
  return outcome;
}
