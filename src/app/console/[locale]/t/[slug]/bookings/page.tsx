import { BrainSyncButton } from "@/components/catalog/brain-sync-button";
import { FileImportForm } from "@/components/catalog/file-import-form";
import { ServiceRow } from "@/components/catalog/service-row";
import { CreateServiceForm } from "@/components/console/create-service-form";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { isFuture } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { NewBookingForm } from "@/components/booking/new-booking-form";
import { DecideBooking, WhatsAppButton } from "@/components/booking/booking-request-controls";
import { bookingMessage, whatsappLink, whatsappNumber, type MessageLocale } from "@/lib/booking-whatsapp";
import { cancelBookingAction, completeBookingAction } from "@/server/booking/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { businessToday, resolveTimeZone } from "@/lib/timezone";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-50 text-emerald-700",
  declined: "bg-rose-50 text-rose-700",
  completed: "bg-blue-50 text-blue-700",
  canceled: "bg-slate-100 text-slate-500",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting you",
  confirmed: "Confirmed",
  declined: "Declined",
  completed: "Completed",
  canceled: "Canceled",
};

type BookingLine = {
  id: string;
  service_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  starts_at: string;
  ends_at: string | null;
  party_size: number;
  status: string;
  customer_locale: string | null;
};

/** Bookable services + real bookings (Customer Agent Master Prompt §26). Every booking here was written by the create_booking tool — none are fabricated. */
const PAGE_SIZE = 50;

export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, slug } = await params;
  const page = parsePage((await searchParams).page);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const now = new Date().toISOString();
  // Counts are exact (counted in Postgres), and the list is paged — every booking is reachable.
  const [{ data: allServices }, { data: bookings }, { data: currency }, { count: totalBookings }, { count: upcomingBookings }, { data: requests }] = await Promise.all([
    supabase
      .from("bookable_services")
      .select("id, name, description, duration_minutes, price_minor, price_unit, capacity, customer_sets_end, online_booking, requires_approval, is_active, source, archived_at")
      .eq("tenant_id", tenant.id)
      .order("created_at"),
    supabase
      .from("bookings")
      .select("id, service_id, customer_name, customer_phone, starts_at, ends_at, party_size, source, notes, status, customer_locale, created_at")
      .eq("tenant_id", tenant.id)
      .order("starts_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "confirmed")
      .gt("starts_at", now),
    // Requests from the Agent waiting for the owner's answer, oldest first.
    supabase
      .from("bookings")
      .select("id, service_id, customer_name, customer_phone, customer_email, starts_at, ends_at, party_size, notes, status, customer_locale, created_at")
      .eq("tenant_id", tenant.id)
      .eq("status", "pending")
      .order("created_at")
      .limit(50),
  ]);
  const exponent = currency?.exponent ?? 2;
  // Deleted services are hidden; their past bookings still show the service's name.
  const services = (allServices ?? []).filter((s) => s.archived_at === null);
  // Times are shown in the business's own time zone (where its opening hours apply).
  const tz = resolveTimeZone(tenant.timezone);
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const today = businessToday(tenant.timezone);
  const serviceNameById = new Map(
    (allServices ?? []).map((s) => [s.id, s.name[locale] ?? Object.values(s.name)[0] ?? ""]),
  );
  const businessName = tenant.business_name[locale] ?? Object.values(tenant.business_name)[0] ?? tenant.slug;

  // WhatsApp: the booking's details, ready to send, in the language the customer used on the Agent.
  const whatsapp = (b: BookingLine) => {
    const number = whatsappNumber(b.customer_phone, tenant.country);
    if (!number || !["pending", "confirmed", "declined"].includes(b.status)) return null;
    const lang: MessageLocale = b.customer_locale === "ar" || b.customer_locale === "fr" ? b.customer_locale : b.customer_locale === "en" ? "en" : locale === "ar" || locale === "fr" ? locale : "en";
    const service = (allServices ?? []).find((s) => s.id === b.service_id);
    const text = bookingMessage({
      kind: b.status === "declined" ? "declined" : "confirmed",
      locale: lang,
      customerName: b.customer_name,
      businessName: tenant.business_name[lang] ?? businessName,
      serviceName: service ? (service.name[lang] ?? Object.values(service.name)[0] ?? "") : "",
      date: new Date(b.starts_at).toLocaleDateString(lang, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }),
      time: new Date(b.starts_at).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }),
      endTime: b.ends_at ? new Date(b.ends_at).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }) : null,
      partySize: b.party_size,
    });
    return {
      href: whatsappLink(number, text),
      label: b.status === "declined" ? "Send the apology on WhatsApp" : "Send the booking confirmation on WhatsApp",
    };
  };
  const since = (iso: string) => {
    const minutes = Math.max(0, Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 60000));
    return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : day(iso);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Bookings</h1>

      {(requests ?? []).length > 0 && (
        <section id="requests" className="scroll-mt-20 rounded-xl border-2 border-amber-300 bg-amber-50/60 p-4" data-testid="booking-requests">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            Booking requests waiting for you ({(requests ?? []).length})
          </h2>
          <p className="mt-0.5 text-xs text-amber-800">The customer is waiting on your Agent — confirm or decline and they see your answer within seconds.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {(requests ?? []).map((r) => {
              const wa = whatsapp(r);
              return (
                <li
                  key={r.id}
                  id={`booking-${r.id}`}
                  className="flex scroll-mt-24 flex-col gap-3 rounded-lg border border-amber-200 bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                  data-testid="booking-request"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {serviceNameById.get(r.service_id) ?? "—"} · {day(r.starts_at)} · {clock(r.starts_at)}
                      {r.ends_at ? `–${clock(r.ends_at)}` : ""}
                    </p>
                    <p className="text-slate-600">
                      {r.customer_name ?? "—"} · {r.party_size === 1 ? "1 person" : `${r.party_size} people`}
                      {r.customer_phone && (
                        <span className="ms-1 text-slate-500" dir="ltr">
                          · {r.customer_phone}
                        </span>
                      )}
                    </p>
                    {r.notes && <p className="text-xs text-slate-500">“{r.notes}”</p>}
                    <p className="text-xs text-slate-400">Requested {since(r.created_at)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <DecideBooking bookingId={r.id} locale={locale} slug={slug} />
                    {wa && <WhatsAppButton href={wa.href} label={wa.label} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile
          icon="branches"
          accent="emerald"
          label="Services"
          value={String(services.length)}
          trend={null}
          href={`/${locale}/${slug}/bookings#services`}
        />
        <KpiTile icon="orders" accent="blue" label="Upcoming bookings" value={String(upcomingBookings ?? 0)} trend={null} href={`/${locale}/${slug}/bookings#bookings`} />
        <KpiTile
          icon="audit"
          accent="purple"
          label="Total bookings"
          value={String(totalBookings ?? 0)}
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
                description: s.description?.[locale] ?? Object.values(s.description ?? {})[0] ?? "",
                durationMinutes: s.duration_minutes,
                priceMinor: s.price_minor,
                priceLabel: s.price_minor !== null ? formatMoney(s.price_minor, tenant.currency, exponent, locale) : null,
                priceUnit: s.price_unit,
                capacity: s.capacity,
                customerSetsEnd: s.customer_sets_end,
                onlineBooking: s.online_booking,
                requiresApproval: s.requires_approval,
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

      {services.some((s) => s.is_active) && (
        <section id="new-booking" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">New booking</h2>
          <p className="mb-3 text-xs text-slate-500">Book a customer in by phone or at the counter. Opening hours and each service&apos;s capacity are checked.</p>
          <NewBookingForm
            locale={locale}
            slug={slug}
            today={today}
            services={services
              .filter((s) => s.is_active)
              .map((s) => ({
                id: s.id,
                name: s.name[locale] ?? Object.values(s.name)[0] ?? "",
                durationMinutes: s.duration_minutes,
                customerSetsEnd: s.customer_sets_end,
                capacity: s.capacity,
              }))}
          />
        </section>
      )}

      <section id="bookings" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Bookings</h2>
        {(bookings ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">Service</th>
                  <th className="py-2 text-start font-medium">Customer</th>
                  <th className="py-2 text-start font-medium">Date</th>
                  <th className="py-2 text-start font-medium">Time in</th>
                  <th className="py-2 text-start font-medium">Time out</th>
                  <th className="py-2 text-start font-medium">People</th>
                  <th className="py-2 text-start font-medium">From</th>
                  <th className="py-2 text-start font-medium">Status</th>
                  <th className="py-2 text-start font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(bookings ?? []).map((b) => {
                  const wa = whatsapp(b);
                  return (
                  <tr key={b.id} id={`booking-row-${b.id}`} className={`border-b border-slate-100 last:border-0 ${b.status === "pending" ? "bg-amber-50/60" : ""}`}>
                    <td className="py-2 font-medium text-slate-900">{serviceNameById.get(b.service_id) ?? "—"}</td>
                    <td className="py-2 text-slate-600">
                      {b.customer_name ?? "—"}
                      {b.customer_phone && <span className="block text-xs text-slate-400" dir="ltr">{b.customer_phone}</span>}
                      {b.notes && <span className="block text-xs text-slate-400">“{b.notes}”</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 text-slate-600">{day(b.starts_at)}</td>
                    <td className="py-2 text-slate-600">{clock(b.starts_at)}</td>
                    <td className="py-2 text-slate-600">{b.ends_at ? clock(b.ends_at) : "—"}</td>
                    <td className="py-2 text-slate-600">{b.party_size}</td>
                    <td className="py-2 text-xs text-slate-500">
                      {b.source === "console" ? "Console" : b.source === "agent_form" ? "Agent booking form" : "Agent chat"}
                    </td>
                    <td className="py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[b.status]}`}>
                        {STATUS_LABEL[b.status] ?? b.status}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                      {b.status === "pending" && <DecideBooking bookingId={b.id} locale={locale} slug={slug} compact />}
                      {wa && <WhatsAppButton href={wa.href} label={wa.label} compact />}
                      {b.status === "confirmed" && (
                        <form action={completeBookingAction} className="inline">
                          <input type="hidden" name="bookingId" value={b.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="slug" value={slug} />
                          <button type="submit" className="me-3 text-xs font-medium text-emerald-700 hover:underline">
                            Completed
                          </button>
                        </form>
                      )}
                      {b.status === "confirmed" && isFuture(b.starts_at) && (
                        <form action={cancelBookingAction} className="inline">
                          <input type="hidden" name="bookingId" value={b.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="slug" value={slug} />
                          <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                            Cancel
                          </button>
                        </form>
                      )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No bookings yet" description="Bookings the Agent takes will show up here." />
        )}
        <Pagination basePath={`/${locale}/${slug}/bookings`} params={{}} page={page} pageSize={PAGE_SIZE} total={totalBookings ?? 0} />
      </section>
    </div>
  );
}
