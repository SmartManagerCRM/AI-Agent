"use client";

import Image from "next/image";
import { useAgentT } from "./agent-i18n";

import { categoryIcon, serviceIcon, toneFor } from "./agent-model";
import { focusRing, ProductCard, SectionHeader, useAgentUi } from "./agent-ui";
import { AgentAvatar } from "./agent-avatar";
import { BusinessMark, CartButton, LanguageSwitcher } from "./chrome";
import { CalendarIcon, ChevronIcon, ClockIcon, MailIcon, PhoneIcon, PinIcon, SendIcon } from "./icons";

// n tiles → n columns (up to 4) so a short row never leaves an orphan; 5–6 tiles wrap 3-per-row on
// phones and sit in one row on desktop.
const TILE_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-3 lg:grid-cols-6",
};

const ROLE_KEYS = new Set(["cafe", "restaurant", "salon", "spa", "gym", "clinic", "engineering", "service_business"]);

export function capabilityKey(ordering: boolean, booking: boolean): "orderBook" | "orderOnly" | "bookOnly" | "questionsOnly" {
  if (ordering && booking) return "orderBook";
  if (ordering) return "orderOnly";
  if (booking) return "bookOnly";
  return "questionsOnly";
}

type Tile = { key: string; label: string; sub?: string; icon: string; tone: string; onClick: () => void; href?: string };

export function HomeView() {
  const t = useAgentT();
  const ui = useAgentUi();
  const { businessName, businessTypeKey, aiName, categories, products, services, orderingEnabled, info, text, popularIds } = ui;

  // What the page shows follows what the business actually has: its real catalog (browsable even when
  // online ordering is off — then there's simply no Add/cart), its services, and its contact details.
  const hasCatalog = products.length > 0;
  const canOrder = orderingEnabled && hasCatalog;
  const hasBooking = services.length > 0;
  const capability = capabilityKey(canOrder, hasBooking);
  const roleKey = ROLE_KEYS.has(businessTypeKey) ? businessTypeKey : hasCatalog ? "shop" : "default";
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const tiles: Tile[] = [];
  if (hasCatalog) {
    for (const c of categories) {
      const count = products.filter((p) => p.categoryId === c.id).length;
      if (count === 0) continue;
      tiles.push({
        key: c.id,
        label: text(c.name),
        sub: t("home.itemCount", { count }),
        icon: categoryIcon(c.name) ?? text(c.name).charAt(0).toUpperCase(),
        tone: toneFor(c.id),
        onClick: () => ui.go("browse", { categoryId: c.id }),
      });
    }
  }
  const extras: Tile[] = [];
  if (hasBooking) {
    extras.push({ key: "book", label: t("home.tiles.book"), icon: "📅", tone: "from-agent-50 to-agent-100", onClick: () => scrollTo("agent-services") });
  }
  if (!canOrder && !hasBooking) {
    extras.push({ key: "quote", label: t("home.tiles.quote"), icon: "📝", tone: "from-sky-50 to-indigo-100", onClick: () => ui.openChat(t("prompts.quote")) });
  }
  if (info.phone && !canOrder) {
    extras.push({ key: "call", label: t("home.tiles.call"), icon: "📞", tone: "from-amber-50 to-orange-100", onClick: () => {}, href: `tel:${info.phone.replace(/\s+/g, "")}` });
  }
  const maxCategoryTiles = Math.max(0, 6 - extras.length);
  // Products outside any category (or no categories at all) are still reachable through "Everything".
  const uncategorized = hasCatalog ? products.filter((p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId)) : [];
  const needsAll = tiles.length > maxCategoryTiles || uncategorized.length > 0;
  const shownTiles = [...tiles.slice(0, needsAll ? Math.max(0, maxCategoryTiles - 1) : maxCategoryTiles)];
  if (needsAll) {
    shownTiles.push({ key: "all", label: t("home.tiles.all"), sub: t("home.itemCount", { count: products.length }), icon: "🧭", tone: "from-slate-50 to-slate-100", onClick: () => ui.go("browse") });
  }
  shownTiles.push(...extras);

  const popular = popularIds.map((id) => products.find((p) => p.id === id)).filter((p) => !!p).slice(0, 6);
  const rails = hasCatalog
    ? categories
        .map((c) => ({ category: c, items: products.filter((p) => p.categoryId === c.id) }))
        .filter((r) => r.items.length > 0)
        // Two rails keep the first screen light; Browse ("See all") shows every category.
        .slice(0, 2)
    : [];
  // With no category rail to show, the uncategorized products get one of their own.
  const looseRail = rails.length < 2 && uncategorized.length > 0 ? uncategorized : [];

  return (
    <div className="flex flex-col gap-8 pb-8">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section
        aria-labelledby="agent-welcome"
        className="relative isolate overflow-hidden rounded-b-[2rem] px-4 pt-4 pb-24 text-white sm:px-6 lg:rounded-[2rem] lg:px-10 lg:pt-6 lg:pb-28"
        style={{
          backgroundImage:
            "radial-gradient(circle at 88% 8%, rgba(47,201,154,0.38), transparent 42%), radial-gradient(circle at 0% 100%, rgba(47,201,154,0.2), transparent 48%), linear-gradient(160deg, #052a22 0%, #0b4f3f 58%, #0c6a53 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background-image:radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:18px_18px]"
          aria-hidden="true"
        />
        <div className="flex items-center gap-3">
          <BusinessMark />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base leading-tight font-bold">{businessName}</p>
            {info.city && <p className="truncate text-xs text-white/65">{info.city}</p>}
          </div>
          <LanguageSwitcher tone="dark" />
          <CartButton tone="dark" />
        </div>

        <div className="mt-5 flex items-end gap-2 sm:gap-4 lg:mt-8">
          <Image
            src="/brand/agent-character.png"
            alt=""
            width={480}
            height={326}
            priority
            className="w-[44%] max-w-[220px] shrink-0 [mask-image:linear-gradient(to_bottom,black_78%,transparent_97%)] lg:max-w-[280px]"
          />
          <div className="motion-safe:animate-agent-rise mb-4 min-w-0 flex-1 rounded-3xl rounded-es-md bg-white/10 p-4 sm:max-w-sm sm:flex-none lg:max-w-md lg:p-5 ring-1 ring-white/20 backdrop-blur-md [animation-delay:120ms]">
            <p className="text-sm text-white/85">{t("home.hi")} 👋</p>
            <p className="mt-0.5 text-[1.35rem] leading-tight font-extrabold tracking-tight break-words sm:text-2xl">
              {t("home.iam", { name: aiName })}
            </p>
            <p className="mt-1.5 text-[13px] leading-snug text-white/75">{t(`role.${roleKey}`)}</p>
          </div>
        </div>

        <h1 id="agent-welcome" className="mt-4 max-w-2xl">
          <span className="block text-lg font-medium text-white/80">{t("home.welcomeTo")}</span>
          <span className="block text-[2.1rem] leading-[1.1] font-extrabold tracking-tight break-words sm:text-5xl">{businessName}</span>
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/80">{t(`home.capabilities.${capability}`)}</p>
        {ui.activeTable && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-agent-400 px-3.5 py-1.5 text-sm font-bold text-agent-950">
            🍽️ {t("home.table", { label: ui.activeTable.label })}
          </p>
        )}
      </section>

      {/* ── Quick actions (overlap the hero) ───────────────────────── */}
      <div className="relative z-10 -mt-24 flex flex-col gap-3 px-4 sm:px-6 lg:-mt-28 lg:px-10">
        {shownTiles.length > 0 && (
          <ul className={`grid gap-2.5 sm:gap-3 ${TILE_COLUMNS[shownTiles.length] ?? "grid-cols-3"}`}>
            {shownTiles.map((tile, index) => {
              const inner = (
                <>
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-[1.7rem] font-bold text-slate-700 sm:h-14 sm:w-14 ${tile.tone}`}
                    aria-hidden="true"
                  >
                    {tile.icon}
                  </span>
                  <span className="line-clamp-2 text-center text-[13px] leading-tight font-semibold text-slate-900">{tile.label}</span>
                  {tile.sub && <span className="-mt-1 text-[11px] text-slate-500">{tile.sub}</span>}
                </>
              );
              const cls = `${focusRing} motion-safe:animate-agent-rise flex h-full min-h-28 w-full flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-1 py-3 shadow-[0_10px_30px_-14px_rgba(5,42,34,0.45)] ring-1 ring-slate-900/5 transition hover:-translate-y-0.5 active:scale-[0.98]`;
              return (
                <li key={tile.key} style={{ animationDelay: `${80 + index * 40}ms` }}>
                  {tile.href ? (
                    <a href={tile.href} className={cls}>
                      {inner}
                    </a>
                  ) : (
                    <button type="button" onClick={tile.onClick} className={cls}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={() => ui.openChat()}
          className={`${focusRing} group flex items-center gap-3 rounded-3xl bg-white p-2.5 ps-3 text-start shadow-[0_10px_30px_-14px_rgba(5,42,34,0.45)] ring-1 ring-slate-900/5 transition hover:ring-agent-300`}
        >
          <AgentAvatar size={42} online />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-bold text-slate-900">{t("ask.title", { name: aiName })}</span>
            <span className="block truncate text-xs text-slate-500">{t(`ask.subtitle.${capability}`)}</span>
          </span>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-agent-700 text-white shadow-md transition group-hover:bg-agent-800">
            <SendIcon size={18} className="rtl:-scale-x-100" />
          </span>
        </button>
      </div>

      {/* ── Popular (only from real order history) ─────────────────── */}
      {hasCatalog && popular.length > 0 && (
        <section className="flex flex-col gap-3 px-4 sm:px-6 lg:px-10" aria-label={t("home.popular")}>
          <SectionHeader title={`🔥 ${t("home.popular")}`} />
          <Rail>
            {popular.map((p) => (
              <ProductCard key={p.id} product={p} variant="rail" />
            ))}
          </Rail>
        </section>
      )}

      {/* ── Catalog rails ───────────────────────────────────────────── */}
      {rails.map(({ category, items }) => (
        <section key={category.id} className="flex flex-col gap-3 px-4 sm:px-6 lg:px-10" aria-label={text(category.name)}>
          <SectionHeader
            title={`${categoryIcon(category.name) ?? ""} ${text(category.name)}`.trim()}
            action={{ label: t("home.seeAll"), onClick: () => ui.go("browse", { categoryId: category.id }) }}
          />
          <Rail>
            {items.slice(0, 6).map((p) => (
              <ProductCard key={p.id} product={p} variant="rail" />
            ))}
          </Rail>
        </section>
      ))}

      {looseRail.length > 0 && (
        <section className="flex flex-col gap-3 px-4 sm:px-6 lg:px-10" aria-label={t("home.tiles.all")}>
          <SectionHeader title={t("home.tiles.all")} action={{ label: t("home.seeAll"), onClick: () => ui.go("browse") }} />
          <Rail>
            {looseRail.slice(0, 8).map((p) => (
              <ProductCard key={p.id} product={p} variant="rail" />
            ))}
          </Rail>
        </section>
      )}

      {/* ── Bookable services ───────────────────────────────────────── */}
      {hasBooking && (
        <section id="agent-services" className="flex scroll-mt-20 flex-col gap-3 px-4 sm:px-6 lg:px-10">
          <SectionHeader title={t("home.services")} />
          <ul className="grid gap-3 sm:grid-cols-2">
            {services.map((s) => {
              const name = text(s.name);
              return (
                <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-900/5">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-agent-50 to-agent-100 text-2xl" aria-hidden="true">
                    {serviceIcon(businessTypeKey)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-slate-900">{name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon size={13} /> {t("home.duration", { minutes: s.durationMinutes })}
                      </span>
                      {s.priceMinor !== null && <span className="font-semibold text-slate-800">{ui.money(s.priceMinor)}</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => ui.openChat(t("prompts.bookService", { service: name }))}
                    className={`${focusRing} flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-agent-700 px-4 text-xs font-semibold text-white hover:bg-agent-800`}
                    aria-label={t("home.bookNamed", { name })}
                  >
                    <CalendarIcon size={15} />
                    {t("home.book")}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── Business info ───────────────────────────────────────────── */}
      <BusinessInfoCard />

      <p className="flex items-center justify-center gap-1.5 px-4 text-center text-xs text-slate-400">
        <Image src="/brand/logo-mark.png" alt="" width={16} height={16} className="rounded" />
        {t("poweredBy")}
      </p>
    </div>
  );
}

function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-10 lg:scroll-px-10 lg:px-10 [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function BusinessInfoCard() {
  const t = useAgentT();
  const { info, about, businessName } = useAgentUi();
  const hasAny = about || info.address || info.city || info.phone || info.email || info.todayHours;
  if (!hasAny) return null;
  // The branch address often already ends with the city — don't print it twice.
  const cityInAddress = !!(info.address && info.city && info.address.toLocaleLowerCase().includes(info.city.toLocaleLowerCase()));
  const location = [info.address, cityInAddress ? null : info.city].filter(Boolean).join(" · ");
  return (
    <section id="agent-contact" className="mx-4 flex scroll-mt-20 flex-col gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 sm:mx-6 lg:mx-10">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">{t("info.title", { name: businessName })}</h2>
        {about && (
          <p dir="auto" className="mt-1.5 text-sm leading-relaxed text-slate-600">
            {about}
          </p>
        )}
      </div>
      <ul className="flex flex-col gap-3 text-sm text-slate-700">
        {location && (
          <li className="flex items-start gap-3">
            <InfoIcon><PinIcon size={18} /></InfoIcon>
            <span className="pt-2">{location}</span>
          </li>
        )}
        {info.todayHours && (
          <li className="flex items-start gap-3">
            <InfoIcon><ClockIcon size={18} /></InfoIcon>
            <span className="pt-2">
              {info.todayHours.length > 0 ? (
                <>
                  <span className="font-semibold text-slate-900">{t("info.today")}</span>{" "}
                  <span dir="ltr" className="tabular-nums">{info.todayHours.join(", ")}</span>
                </>
              ) : (
                t("info.closedToday")
              )}
            </span>
          </li>
        )}
        {info.phone && (
          <li className="flex items-center gap-3">
            <InfoIcon><PhoneIcon size={18} /></InfoIcon>
            <span dir="ltr" className="flex-1 text-start tabular-nums">{info.phone}</span>
            <a
              href={`tel:${info.phone.replace(/\s+/g, "")}`}
              className={`${focusRing} flex h-10 items-center gap-1.5 rounded-full bg-agent-50 px-4 text-xs font-semibold text-agent-800 ring-1 ring-agent-100 hover:bg-agent-100`}
            >
              {t("info.call")}
              <ChevronIcon size={14} className="rtl:-scale-x-100" />
            </a>
          </li>
        )}
        {info.email && (
          <li className="flex items-center gap-3">
            <InfoIcon><MailIcon size={18} /></InfoIcon>
            <a href={`mailto:${info.email}`} className={`${focusRing} min-w-0 truncate rounded text-agent-800 underline-offset-2 hover:underline`}>
              {info.email}
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}

function InfoIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-agent-50 text-agent-700">{children}</span>;
}
