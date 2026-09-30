import QRCode from "qrcode";

import { CopyButton } from "@/components/console/copy-button";
import type { GoLiveState } from "@/server/agent-public/go-live";

import { PauseAgentForm, PublishAgentForm } from "./go-live-forms";

const MODE_LABEL: Record<GoLiveState["deploymentMode"], string> = {
  external_agent: "Public Agent link",
  website_widget: "Website widget",
  both: "Public Agent link + website widget",
};

const LANGUAGE_LABEL: Record<string, string> = { en: "English", ar: "Arabic", fr: "French" };

/** LIVE / NOT LIVE — deployment status, never Brain readiness. */
export function LiveBadge({ status }: { status: GoLiveState["status"] }) {
  const live = status === "published";
  const paused = status === "paused";
  return (
    <span
      data-testid="agent-live-badge"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        live ? "bg-emerald-50 text-emerald-700" : paused ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      <span aria-hidden>{live ? "●" : "○"}</span>
      {live ? "LIVE" : paused ? "PAUSED" : "NOT LIVE"}
    </span>
  );
}

/**
 * Go live: the review before publishing, and the live Agent's link, QR
 * code and pause control after. Shown on Business Brain (step 5) and on the
 * Agent page.
 */
export async function GoLivePanel({ state, slug, locale }: { state: GoLiveState; slug: string; locale: string }) {
  if (state.isLive) {
    // Encodes exactly the canonical public URL — generated locally, no third-party QR service.
    const qr = await QRCode.toDataURL(state.agentUrl, { width: 480, margin: 1 });
    return (
      <section id="go-live" className="scroll-mt-20 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4" data-testid="go-live-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-emerald-800">✓ Agent is Live</h2>
          <LiveBadge status={state.status} />
        </div>
        <p className="mt-2 text-sm text-slate-700">Your Agent is live:</p>
        <p className="mt-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-slate-900 ring-1 ring-slate-200" data-testid="agent-url">
          {state.agentUrl}
        </p>
        {state.publishedAt && (
          <p className="mt-1 text-xs text-slate-500">Published {new Date(state.publishedAt).toLocaleString(locale)}</p>
        )}
        {state.deploymentMode === "website_widget" && (
          <p className="mt-2 text-xs text-amber-700">
            Your Agent is set to “Website widget only”, so this link shows “not live” — switch to “Both” on the Agent page to use it.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={state.agentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Open Agent
          </a>
          <CopyButton value={state.agentUrl} label="Copy Link" />
          <details className="group">
            <summary className="cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Generate QR
            </summary>
            <div className="mt-2 flex items-end gap-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated locally by the `qrcode` package */}
              <img src={qr} alt={`QR code for ${state.agentUrl}`} width={144} height={144} className="rounded-md" />
              <a
                href={qr}
                download={`${slug}-agent-qr.png`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Download QR code
              </a>
            </div>
          </details>
          <PauseAgentForm slug={slug} locale={locale} />
        </div>
      </section>
    );
  }

  const required = state.items.filter((i) => i.required);
  const optional = state.items.filter((i) => !i.required);
  const paused = state.status === "paused";
  const { offerings } = state;
  return (
    <section id="go-live" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4" data-testid="go-live-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          {paused
            ? "Your Agent is paused"
            : state.canPublish
              ? "Your AI Agent is ready to go live."
              : "Go live — a few things first"}
        </h2>
        <LiveBadge status={state.status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {paused
          ? "Customers opening your link see “temporarily unavailable”. Publish again to bring it back."
          : "Customers can only reach your Agent after you publish it. Your Business Brain doesn't need to be 100% complete."}
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Business name" value={state.businessName || "—"} />
        <Row label="Business type" value={state.businessTypeLabel ?? "—"} />
        <Row
          label="Products / services"
          value={`${state.activeProducts} in catalog${offerings.importable.length ? ` · ${offerings.importable.length} approved to add` : ""}${state.bookingServices ? ` · ${state.bookingServices} bookable service(s)` : ""}`}
        />
        <Row label="Approved knowledge" value={`${state.approvedKnowledge} fact(s)`} />
        <Row label="Language" value={state.languages.map((l) => LANGUAGE_LABEL[l] ?? l).join(", ")} />
        <Row label="Deployment mode" value={MODE_LABEL[state.deploymentMode]} />
        <Row label="Online ordering" value={state.orderingEnabled ? "On" : "Off — customers can chat and browse"} />
      </dl>

      <p className="mt-4 text-sm text-slate-700">Your public Agent URL will be:</p>
      <p className="mt-1 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800" data-testid="agent-url">
        {state.agentUrl}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Checklist title="Required" items={required} />
        <Checklist title="Optional" items={optional} />
      </div>

      {(offerings.unreadable > 0 || offerings.otherCurrency > 0 || offerings.unpriced > 0) && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Not added to your catalog:
          {offerings.unreadable > 0 && ` ${offerings.unreadable} approved product name(s) look like unreadable scan text — reject them in Review.`}
          {offerings.otherCurrency > 0 && ` ${offerings.otherCurrency} priced in another currency.`}
          {offerings.unpriced > 0 && ` ${offerings.unpriced} without a price.`}
        </p>
      )}

      <div className="mt-4">
        <PublishAgentForm
          slug={slug}
          locale={locale}
          canPublish={state.canPublish}
          importable={offerings.importable.length}
          label={paused ? "Publish again" : "Publish Agent"}
        />
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-end font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function Checklist({ title, items }: { title: string; items: GoLiveState["items"] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((i) => (
          <li key={i.key} className="flex gap-2">
            <span aria-hidden className={i.ok ? "text-emerald-600" : i.required ? "text-red-600" : "text-slate-400"}>
              {i.ok ? "✓" : i.required ? "✗" : "○"}
            </span>
            <span>
              <span className="font-medium text-slate-800">{i.label}</span>
              <span className="text-slate-500"> — {i.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
