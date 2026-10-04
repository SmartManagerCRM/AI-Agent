/** Runs once when a server instance starts (Next.js instrumentation hook). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTranslationSweeps } = await import("@/server/translate/schedule");
    startTranslationSweeps();
    const { startSubscriptionEmailSweeps } = await import("@/server/email/subscription-queue");
    startSubscriptionEmailSweeps();
  }
}
