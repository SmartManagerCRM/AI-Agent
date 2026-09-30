import type { Readiness } from "@/server/brain/discovery/readiness";

const STATE_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  found: "bg-amber-50 text-amber-700",
  conflict: "bg-red-50 text-red-700",
  missing: "bg-slate-100 text-slate-500",
};
const STATE_LABEL: Record<string, string> = { confirmed: "Confirmed", found: "To review", conflict: "Conflict", missing: "Missing" };
const AREA_LABEL: Record<string, string> = {
  identity: "Business name",
  business_type: "Business type",
  contact: "Contact",
  location: "Address",
  hours: "Opening hours",
  offerings: "Products / services",
  prices: "Prices",
  policies: "Policies",
  faq: "FAQ",
  about: "Description",
};

/** Readiness from the Brain's real contents (see `computeReadiness`). */
export function ReadinessCard({ readiness }: { readiness: Readiness }) {
  const tone = readiness.score >= 80 ? "text-emerald-600" : readiness.score >= 50 ? "text-amber-600" : "text-slate-700";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Agent readiness</h2>
          <p className="text-xs text-slate-500">How much your Agent can reliably answer — based on what you&apos;ve confirmed.</p>
        </div>
        <p className={`text-3xl font-semibold tabular-nums ${tone}`}>{readiness.score}%</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={readiness.score} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${readiness.score}%` }} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {readiness.areas.map((area) => (
          <li key={area.key} className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[area.state]}`} title={area.detail}>
            {AREA_LABEL[area.key]} · {STATE_LABEL[area.state]}
          </li>
        ))}
      </ul>
      {readiness.catalog && readiness.catalog.found > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Products found</dt>
            <dd className="text-base font-semibold text-slate-900">{readiness.catalog.found}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Pending review · confirmed</dt>
            <dd className="text-base font-semibold text-slate-900">
              {readiness.catalog.pending} · {readiness.catalog.confirmed}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">With price · missing price</dt>
            <dd className="text-base font-semibold text-slate-900">
              {readiness.catalog.priced} · {readiness.catalog.missingPrice}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Price conflicts</dt>
            <dd className={`text-base font-semibold ${readiness.catalog.conflicts ? "text-red-600" : "text-slate-900"}`}>{readiness.catalog.conflicts}</dd>
          </div>
        </dl>
      )}
      {readiness.nextSteps.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-700">Next steps</p>
          <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
            {readiness.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
