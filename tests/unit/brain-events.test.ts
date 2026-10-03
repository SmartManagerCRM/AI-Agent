import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";

import { legacyEventI18n } from "@/lib/brain-events";

import en from "../../messages/en.json";

const EVENTS = en.console.discovery.event as Record<string, string>;
const render = (message: string) => {
  const i18n = legacyEventI18n(message);
  return i18n ? String(new IntlMessageFormat(EVENTS[i18n.key], "en").format(i18n.values)) : null;
};

describe("old Business Brain events (recorded in English, without a key)", () => {
  it("read back word for word from their key, so every language can show them", () => {
    for (const message of [
      "Analysis started.",
      "Analysis cancelled.",
      "Removed 3 expired, unconfirmed suggestion(s).",
      "Found the website https://qahwa.example.",
      "12 fact candidate(s) prepared.",
      "4 new or changed, 2 unchanged.",
      "4 new or changed, 2 unchanged, 1 conflicting with another source.",
      "Added 5 product(s) and 2 service(s) to your catalog — as drafts until you approve them. 3 were priced in another currency: set your own price on each. 4 photo(s) added.",
      "Added 5 product(s) and 0 service(s) to your catalog — as drafts until you approve them.",
      "Finished — Business Brain readiness 72%.",
      "Reading your Google Maps listing (official Places API).",
      "Reading qahwa.example.",
      "Reading the menu link https://qahwa.example/menu (primary source).",
      "2 page(s) read — 0 new or changed, 2 unchanged.",
      "Analysis budget reached — 3 page(s) kept to rule-based extraction.",
      "No AI model is configured — rule-based extraction only.",
      "AI read 2 page(s) that rules couldn’t fully cover.",
      "No AI needed — rules covered every page.",
      "Menu page read: 4 image(s), 18 item(s) in text; 2 related menu/catalog page(s).",
      "Online ordering found and read: https://order.example",
      "Menu images: 6 found, 3 look like menus — 2 read by OCR, 1 by the vision model, 0 unchanged; 25 item(s).",
    ]) {
      expect(render(message.replace("Menu page read:", "Menu page read (menu):")) ?? "", message).toBe(message);
    }
  });

  it("maps the wording that differs only in punctuation, and leaves raw errors alone", () => {
    expect(legacyEventI18n('Found "Qahwa House" on Google Maps (Café).')).toEqual({ key: "foundGoogle", values: { name: "Qahwa House", type: "Café" } });
    expect(legacyEventI18n('Found "Qahwa House" on Google Maps.')?.values?.type).toBe("none");
    expect(legacyEventI18n("Couldn't add the products and services found to your catalog — they're still here in the Business Brain for review.")?.key).toBe("catalogFailed");
    expect(legacyEventI18n("fetch failed: ECONNRESET")).toBeNull();
  });
});
