import { BrainSyncButton } from "@/components/catalog/brain-sync-button";
import { FileImportForm } from "@/components/catalog/file-import-form";
import { ServiceRow } from "@/components/catalog/service-row";
import { CreateServiceForm } from "@/components/console/create-service-form";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { isFuture } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cancelBookingAction } from "@/server/booking/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  completed: "bg-blue-50 text-blue-700",
  canceled: "bg-slate-100 text-slate-500",
};

/** Bookable services + real bookings (Customer Agent Master Prompt §26). Every booking here was written by the create_booking tool — none are fabricated. */
export default async function BookingsPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: allServices }, { data: bookings }, { data: currency }] = await Promise.all([
    supabase
      .from("bookable_services")
      .select("id, name, duration_minutes, price_minor, is_active, source, archived_at")
      .eq("tenant_id", tenant.id)
      .order("created_at"),
    supabase
      .from("bookings")
      .select("id, service_id, customer_name, customer_phone, starts_at, status")
      .eq("tenant_id", tenant.id)
      .order("starts_at", { ascending: false })
      .limit(200),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);
  const exponent = currency?.exponent ?? 2;
  // Deleted services are hidden; their past bookings still show the service's name.
  const services = (allServices ?? []).filter((s) => s.archived_at === null);
  const serviceNameById = new Map(
    (allServices ?? []).map((s) => [s.id, s.name[locale] ?? Object.values(s.name)[0] ?? ""]),
  );
  const upcoming = (bookings ?? []).filter((b) => b.status === "confirmed" && isFuture(b.starts_at));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Bookings</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile
          icon="branches"
          accent="emerald"
          label="Services"
          value={String(services.length)}
          trend={null}
          href={`/${locale}/${slug}/bookings#services`}
        />
        <KpiTile icon="orders" accent="blue" label="Upcoming bookings" value={String(upcoming.length)} trend={null} href={`/${locale}/${slug}/bookings#bookings`} />
        <KpiTile
          icon="audit"
          accent="purple"
          label="Total bookings"
          value={String((bookings ?? []).length)}
          trend={null}
          href={`/${locale}/${slug}/bookings#bookings`}
        />
      </div>

      <section id="services" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Bookable services</h2>
        <div className="mb-4">
          <CreateServiceForm tenantId={tenant.id} slug={slug} locale={locale} currencyExponent={exponent} />
        </div>
        <details className="mb-4 rounded-md border border-slate-100 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Add services from a file (HTML or PDF)</summary>
          <div className="mt-3">
            <FileImportForm slug={slug} locale={locale} defaultKind="service" />
          </div>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <BrainSyncButton slug={slug} locale={locale} />
          </div>
        </details>
        <div className="flex flex-col gap-2">
          {services.map((s) => (
            <ServiceRow
              key={s.id}
              service={{
                id: s.id,
                name: s.name[locale] ?? Object.values(s.name)[0] ?? "",
                durationMinutes: s.duration_minutes,
                priceMinor: s.price_minor,
                priceLabel: s.price_minor !== null ? formatMoney(s.price_minor, tenant.currency, exponent, locale) : null,
                isActive: s.is_active,
                source: s.source,
              }}
              exponent={exponent}
              locale={locale}
              slug={slug}
            />
          ))}
          {services.length === 0 && (
            <p className="py-2 text-center text-sm text-slate-400">
              Add a service above to let the Agent take bookings.
            </p>
          )}
        </div>
      </section>

      <section id="bookings" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Bookings</h2>
        {(bookings ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">Service</th>
                  <th className="py-2 text-start font-medium">Customer</th>
                  <th className="py-2 text-start font-medium">When</th>
                  <th className="py-2 text-start font-medium">Status</th>
                  <th className="py-2 text-start font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(bookings ?? []).map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 font-medium text-slate-900">{serviceNameById.get(b.service_id) ?? "—"}</td>
                    <td className="py-2 text-slate-600">{b.customer_name ?? b.customer_phone ?? "—"}</td>
                    <td className="py-2 text-slate-600">{new Date(b.starts_at).toLocaleString(locale)}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[b.status]}`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="py-2">
                      {b.status === "confirmed" && isFuture(b.starts_at) && (
                        <form action={cancelBookingAction}>
                          <input type="hidden" name="bookingId" value={b.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="slug" value={slug} />
                          <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                            Cancel
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No bookings yet" description="Bookings the Agent takes will show up here." />
        )}
      </section>
    </div>
  );
}
