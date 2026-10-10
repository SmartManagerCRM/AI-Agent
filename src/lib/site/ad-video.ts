import type { Locale } from "@/i18n/locales";

/** Where an end-card widget sits in the 1080×1920 frame, in percent. */
export type AdCardBox = { left: number; top: number; width: number; height: number };
export type AdCardKey = "tryDemo" | "startTrial" | "annual";
export type AdCut = {
  src: string;
  poster: string;
  captions: { src: string; lang: string; label: string };
  /** When each end-card widget appears (seconds) and where it sits; the Arabic cut has its own timing and layout. */
  cards: { tryDemo: [number, AdCardBox]; startTrial: [number, AdCardBox]; annual: [number, AdCardBox] };
};

const AD_CUTS: { en: AdCut; ar: AdCut; fr: AdCut } = {
  en: {
    src: "/ad/smartmanager-ai-agent.mp4",
    poster: "/ad/poster.jpg",
    captions: { src: "/ad/captions-en.vtt", lang: "en", label: "English" },
    cards: {
      tryDemo: [22.2, { left: 6.48, top: 45.12, width: 87.04, height: 13.33 }],
      startTrial: [22.65, { left: 6.48, top: 60.54, width: 87.04, height: 13.33 }],
      annual: [24.55, { left: 17.86, top: 75.74, width: 64.27, height: 4.79 }],
    },
  },
  ar: {
    src: "/ad/smartmanager-ai-agent-ar.mp4",
    poster: "/ad/poster-ar.jpg",
    captions: { src: "/ad/captions-ar.vtt", lang: "ar", label: "العربية" },
    cards: {
      tryDemo: [37.65, { left: 6.48, top: 41.32, width: 87.04, height: 13.33 }],
      startTrial: [38.1, { left: 6.48, top: 56.21, width: 87.04, height: 13.33 }],
      annual: [45.4, { left: 18.29, top: 77.31, width: 63.42, height: 6.04 }],
    },
  },
  fr: {
    src: "/ad/smartmanager-ai-agent-fr.mp4",
    poster: "/ad/poster-fr.jpg",
    captions: { src: "/ad/captions-fr.vtt", lang: "fr", label: "Français" },
    cards: {
      tryDemo: [23.35, { left: 6.48, top: 46.37, width: 87.04, height: 13.94 }],
      startTrial: [23.89, { left: 6.48, top: 62.4, width: 87.04, height: 13.33 }],
      annual: [26.0, { left: 12.66, top: 77.61, width: 74.68, height: 4.79 }],
    },
  },
};

/** The ad in the page's language. */
export function adCut(locale: Locale): AdCut {
  return AD_CUTS[locale];
}
