/**
 * "Already greeted on this visit" — so the spoken greeting isn't repeated
 * on every screen. Kept per Agent in sessionStorage; picking another
 * language clears it, so the Agent greets again in the language just chosen.
 */
const GREETED_KEY = "agent-greeted:";

export function wasGreeted(slug: string): boolean {
  try {
    return window.sessionStorage.getItem(GREETED_KEY + slug) === "1";
  } catch {
    return false;
  }
}

export function markGreeted(slug: string) {
  try {
    window.sessionStorage.setItem(GREETED_KEY + slug, "1");
  } catch {
    // Storage blocked: the greeting may be spoken again on the next visit to this page — harmless.
  }
}

/** Called when the customer picks another language: the next page load greets them again, in it. */
export function greetAgain() {
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(GREETED_KEY)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing was remembered, so the greeting plays anyway.
  }
}
