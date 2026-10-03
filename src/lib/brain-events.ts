/**
 * Business Brain timeline events recorded before events carried their own
 * translation key: their fixed English wording (src/server/brain/discovery/
 * pipeline.ts) → the key and values under console.discovery.event.*, so an
 * old analysis reads in the user's language too. Anything else (a raw
 * technical error) has no key and stays as recorded.
 */
export type EventI18n = { key: string; values?: Record<string, string | number> };

const n = (s: string | undefined) => Number(s ?? 0);

const RULES: [RegExp, (m: RegExpExecArray) => EventI18n][] = [
  [/^Analysis cancelled\.$/, () => ({ key: "cancelled" })],
  [/^Analysis started\.$/, () => ({ key: "started" })],
  [/^Removed (\d+) expired, unconfirmed suggestion\(s\)\.$/, (m) => ({ key: "purged", values: { n: n(m[1]) } })],
  [/^Found the website (.+)\.$/, (m) => ({ key: "foundWebsite", values: { url: m[1] } })],
  [/^No Google Maps link, website or menu link given/, () => ({ key: "noInput" })],
  [/^(\d+) fact candidate\(s\) prepared\.$/, (m) => ({ key: "prepared", values: { n: n(m[1]) } })],
  [/^(\d+) new or changed, (\d+) unchanged, (\d+) conflicting with another source\.$/, (m) => ({ key: "savedWithConflicts", values: { created: n(m[1]), unchanged: n(m[2]), conflicts: n(m[3]) } })],
  [/^(\d+) new or changed, (\d+) unchanged\.$/, (m) => ({ key: "saved", values: { created: n(m[1]), unchanged: n(m[2]), conflicts: 0 } })],
  [/^Couldn.t add the products and services found to your catalog/, () => ({ key: "catalogFailed" })],
  [
    /^Added (\d+) product\(s\) and (\d+) service\(s\) to your catalog — as drafts until you approve them\.(?: (\d+) were priced in another currency: set your own price on each\.)?(?: (\d+) photo\(s\) added\.)?$/,
    (m) => ({ key: "catalogAdded", values: { products: n(m[1]), services: n(m[2]), needsPrice: n(m[3]), photos: n(m[4]) } }),
  ],
  [/^Finished — Business Brain readiness (\d+)%\.$/, (m) => ({ key: "finished", values: { score: n(m[1]) } })],
  [/^Reading your Google Maps listing/, () => ({ key: "readingGoogle" })],
  [/^Found "(.+)" on Google Maps(?: \((.+)\))?\.$/, (m) => ({ key: "foundGoogle", values: { name: m[1], type: m[2] ?? "none" } })],
  [/^Reading the menu link (.+) \(primary source\)\.$/, (m) => ({ key: "readingMenu", values: { url: m[1] } })],
  [/^Reading (\S+)\.$/, (m) => ({ key: "readingSite", values: { host: m[1] } })],
  [/^(\d+) page\(s\) skipped as the site.s robots\.txt asks\.$/, (m) => ({ key: "robots", values: { n: n(m[1]) } })],
  [/^(\d+) page\(s\) read — (\d+) new or changed, (\d+) unchanged\.$/, (m) => ({ key: "pagesRead", values: { n: n(m[1]), changed: n(m[2]), unchanged: n(m[3]) } })],
  [/^Analysis budget reached — (\d+) page\(s\)/, (m) => ({ key: "budget", values: { n: n(m[1]) } })],
  [/^No AI model is configured/, () => ({ key: "noModel" })],
  [/^AI read (\d+) page\(s\)/, (m) => ({ key: "aiRead", values: { n: n(m[1]) } })],
  [/^No AI needed/, () => ({ key: "noAi" })],
  [/^Menu page read \([^)]*\): (\d+) image\(s\), (\d+) item\(s\) in text; (\d+) related/, (m) => ({ key: "menuRead", values: { images: n(m[1]), items: n(m[2]), related: n(m[3]) } })],
  [/^Online ordering found and read: (.+)$/, (m) => ({ key: "orderingRead", values: { url: m[1] } })],
  [/^Online ordering link found but not read: (.+?) — (.*)$/, (m) => ({ key: "orderingNotRead", values: { url: m[1], reason: m[2] } })],
  [
    /^Menu images: (\d+) found, (\d+) look like menus — (\d+) read by OCR, (\d+) by the vision model, (\d+) unchanged; (\d+) item\(s\)\.$/,
    (m) => ({ key: "menuImages", values: { found: n(m[1]), menus: n(m[2]), ocr: n(m[3]), vision: n(m[4]), unchanged: n(m[5]), items: n(m[6]) } }),
  ],
];

export function legacyEventI18n(message: string): EventI18n | null {
  for (const [re, build] of RULES) {
    const m = re.exec(message);
    if (m) return build(m);
  }
  return null;
}
