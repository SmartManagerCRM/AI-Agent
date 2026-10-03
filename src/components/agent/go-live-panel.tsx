import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";

import { CopyButton } from "@/components/console/copy-button";
import type { GoLiveState } from "@/server/agent-public/go-live";

import { PauseAgentForm, PublishAgentForm, SyncCatalogForm } from "./go-live-forms";

type T = (key: string, values?: Record<string, string | number>) => string;

/** A launch checklist item worded in the user's language from the same figures (`launchChecklist` decides ok / required). */
function itemText(t: T, item: GoLiveState["items"][number], s: GoLiveState): { label: string; detail: string } {
  const sellable = s.pricedProducts + s.offerings.importable.length;
  const optional = (ok: boolean) => (ok ? t("detail.confirmed") : t("detail.optional"));
  switch (item.key) {
    case "name":
      return { label: t("item.name"), detail: s.businessName || t("detail.missing") };
    case "type":
      return { label: t("item.type"), detail: s.businessTypeLabel ?? t("detail.missing") };
    case "identity":
      return {
        label: t("item.identity"),
        detail: item.ok ? t("detail.identity", { facts: s.approvedKnowledge, products: s.activeProducts }) : t("detail.identityMissing"),
      };
    case "products":
      return {
        label: s.orderingEnabled ? t("item.productsOrdering") : t("item.products"),
        detail:
          sellable > 0
            ? t("detail.products", { n: s.pricedProducts }) + (s.offerings.importable.length ? t("detail.productsImport", { n: s.offerings.importable.length }) : "")
            : s.orderingEnabled
              ? t("detail.productsMissingOrdering")
              : t("detail.productsNone"),
      };
    case "interaction":
      return {
        label: t("item.interaction"),
        detail: [t("detail.chat"), sellable > 0 ? t("detail.browse") : null, s.orderingEnabled && sellable > 0 ? t("detail.order") : null, s.bookingServices > 0 ? t("detail.book") : null]
          .filter(Boolean)
          .join(", "),
      };
    case "plan":
      return {
        label: t("item.plan"),
        detail: s.subscription === "entitled" ? t("detail.planActive") : s.subscription === "none" ? t("detail.planTrial") : t("detail.planEnded"),
      };
    case "hours":
      return { label: t("item.hours"), detail: item.ok ? t("detail.confirmed") : t("detail.hoursOptional") };
    case "description":
    case "policies":
    case "faq":
      return { label: t(`item.${item.key}`), detail: optional(item.ok) };
    default:
      return { label: item.label, detail: item.detail };
  }
}

/** LIVE / NOT LIVE — deployment status, never Brain readiness. */
export function LiveBadge({ status }: { status: GoLiveState["status"] }) {
  const live = status === "published";
  const paused = status === "paused";
  const t = useTranslations("console.goLive");
  return (
    <span
      data-testid="agent-live-badge"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        live ? "bg-emerald-50 text-emerald-700" : paused ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      <span aria-hidden>{live ? "●" : "○"}</span>
      {live ? t("badge.live") : paused ? t("badge.paused") : t("badge.notLive")}
    </span>
  );
}

/**
 * Go live: the review before publishing, and the live Agent's link, QR
 * code and pause control after. Shown on Business Brain (step 5) and on the
 * Agent page.
 */
export async function GoLivePanel({ state, slug, locale }: { state: GoLiveState; slug: string; locale: string }) {
  const t = await getTranslations("console.goLive");
  if (state.isLive) {
    // Encodes exactly the canonical public URL — generated locally, no third-party QR service.
    const qr = await QRCode.toDataURL(state.agentUrl, { width: 480, margin: 1 });
    return (
      <section id="go-live" className="scroll-mt-20 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4" data-testid="go-live-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-emerald-800">{t("isLive")}</h2>
          <LiveBadge status={state.status} />
        </div>
        <p className="mt-2 text-sm text-slate-700">{t("yourAgentIsLive")}</p>
        <p className="mt-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-slate-900 ring-1 ring-slate-200" data-testid="agent-url">
          {state.agentUrl}
        </p>
        {state.publishedAt && (
          <p className="mt-1 text-xs text-slate-500">{t("published", { date: new Date(state.publishedAt).toLocaleString(locale) })}</p>
        )}
        {state.deploymentMode === "website_widget" && (
          <p className="mt-2 text-xs text-amber-700">
            {t("widgetOnly")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={state.agentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            {t("openAgent")}
          </a>
          <CopyButton value={state.agentUrl} label={t("copyLink")} />
          <details className="group">
            <summary className="cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              {t("generateQr")}
            </summary>
            <div className="mt-2 flex items-end gap-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated locally by the `qrcode` package */}
              <img src={qr} alt={t("qrAlt", { url: state.agentUrl })} width={144} height={144} className="rounded-md" />
              <a
                href={qr}
                download={`${slug}-agent-qr.png`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {t("downloadQr")}
              </a>
            </div>
          </details>
          <PauseAgentForm slug={slug} locale={locale} />
        </div>
        {state.offerings.importable.length > 0 && (
          <SyncCatalogForm slug={slug} locale={locale} count={state.offerings.importable.length} />
        )}
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
          {paused ? t("pausedTitle") : state.canPublish ? t("readyTitle") : t("notReadyTitle")}
        </h2>
        <LiveBadge status={state.status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {paused
          ? t("pausedHint")
          : t("publishHint")}
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label={t("row.name")} value={state.businessName || "—"} />
        <Row label={t("row.type")} value={state.businessTypeLabel ?? "—"} />
        <Row
          label={t("row.products")}
          value={`${t("inCatalog", { n: state.activeProducts })}${offerings.importable.length ? t("approvedToAdd", { n: offerings.importable.length }) : ""}${state.bookingServices ? t("bookable", { n: state.bookingServices }) : ""}`}
        />
        <Row label={t("row.knowledge")} value={t("facts", { n: state.approvedKnowledge })} />
        <Row label={t("row.language")} value={state.languages.map((l) => (["en", "ar", "fr"].includes(l) ? t(`lang.${l}`) : l)).join(", ")} />
        <Row label={t("row.mode")} value={t(`mode.${state.deploymentMode}`)} />
        <Row label={t("row.ordering")} value={state.orderingEnabled ? t("orderingOn") : t("orderingOff")} />
      </dl>

      <p className="mt-4 text-sm text-slate-700">{t("urlWillBe")}</p>
      <p className="mt-1 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800" data-testid="agent-url">
        {state.agentUrl}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Checklist title={t("required")} items={required.map((i) => ({ ...i, ...itemText(t, i, state) }))} />
        <Checklist title={t("optional")} items={optional.map((i) => ({ ...i, ...itemText(t, i, state) }))} />
      </div>

      {(offerings.unreadable > 0 || offerings.otherCurrency > 0 || offerings.unpriced > 0) && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("notAdded")}
          {offerings.unreadable > 0 && t("unreadable", { n: offerings.unreadable })}
          {offerings.otherCurrency > 0 && t("otherCurrency", { n: offerings.otherCurrency })}
          {offerings.unpriced > 0 && t("unpriced", { n: offerings.unpriced })}
        </p>
      )}

      <div className="mt-4">
        <PublishAgentForm
          slug={slug}
          locale={locale}
          canPublish={state.canPublish}
          importable={offerings.importable.length}
          label={paused ? t("publishAgain") : t("publish")}
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
