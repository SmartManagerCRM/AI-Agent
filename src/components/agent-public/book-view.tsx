"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { timeWithin } from "@/lib/branch-hours";
import {
  bookServiceAction,
  bookingBranchesAction,
  bookingStatusAction,
  otherBranchesAction,
  serviceDayAction,
  type AgentBookingResult,
  type RequestStatus,
  type ServiceDay,
} from "@/server/agent-public/booking-actions";
import type { BranchChoice } from "@/lib/branch-match";
import type { BranchAvailability } from "@/server/commerce/booking-alternatives";

import { AgentAvatar } from "./agent-avatar";
import { useAgentT } from "./agent-i18n";
import type { AgentService } from "./agent-model";
import { focusRing, useAgentUi } from "./agent-ui";
import { ScreenHeader } from "./chrome";
import { CalendarIcon, CheckIcon, ChevronIcon, ClockIcon, PinIcon } from "./icons";

/** A booking the customer just made (or a request still waiting for the business's answer), kept for this visit. */
type MadeBooking = {
  bookingId: string;
  serviceId: string;
  status: RequestStatus;
  date: string;
  timeIn: string;
  endTime: string | null;
  people: number;
  name: string;
  phone: string;
  requestedAt: number;
  /** The branch it's at (businesses with several). */
  branchName?: string | null;
};

const REQUEST_KEY = "agent-booking:";

function readMade(slug: string): MadeBooking | null {
  try {
    const raw = window.sessionStorage.getItem(REQUEST_KEY + slug);
    return raw ? (JSON.parse(raw) as MadeBooking) : null;
  } catch {
    return null;
  }
}
function writeMade(slug: string, made: MadeBooking | null) {
  try {
    if (made) window.sessionStorage.setItem(REQUEST_KEY + slug, JSON.stringify(made));
    else window.sessionStorage.removeItem(REQUEST_KEY + slug);
  } catch {
    // Storage blocked: the answer still shows while this screen stays open.
  }
}

const fieldCls =
  "w-full rounded-2xl bg-slate-50 px-4 py-3 text-[15px] text-slate-900 ring-1 ring-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-agent-400";

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Duration, price and capacity of a service, as the customer reads them. */
export function useServiceFacts() {
  const t = useAgentT();
  const { money } = useAgentUi();
  return (s: AgentService): string[] => {
    const facts: string[] = [];
    facts.push(s.durationMinutes !== null ? t("book.duration", { minutes: s.durationMinutes }) : t("book.flexible"));
    if (s.customerSetsEnd) facts.push(t("book.youChooseEnd"));
    if (s.priceMinor !== null) {
      const price = money(s.priceMinor);
      facts.push(t(s.priceUnit === "hour" ? "book.priceHour" : s.priceUnit === "person" ? "book.pricePerson" : "book.priceBooking", { price }));
    } else facts.push(t("book.priceOnRequest"));
    return facts;
  };
}

/**
 * Booking on the customer Agent: choose a service, see its details, pick a
 * day and time (free start times for fixed-length services; your own time
 * in / time out for flexible ones), add your details, confirm. A form, not
 * the AI chat — no AI cost. The database decides availability.
 */
export function BookView({ serviceId, onService }: { serviceId: string | null; onService: (id: string) => void }) {
  const t = useAgentT();
  const { services, text, slug, go } = useAgentUi();
  const facts = useServiceFacts();
  const service = services.find((s) => s.id === serviceId) ?? (services.length === 1 ? services[0] : null);

  // A booking made on this visit — a request waiting for the business is picked up again when the customer comes back here.
  const [made, setMadeState] = useState<MadeBooking | null>(null);
  useEffect(() => {
    const stored = readMade(slug);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount (sessionStorage isn't available on the server)
    if (stored) setMadeState(stored);
  }, [slug]);
  const setMade = useCallback(
    (next: MadeBooking | null) => {
      writeMade(slug, next);
      setMadeState(next);
    },
    [slug],
  );
  const madeService = made ? services.find((s) => s.id === made.serviceId) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-white/85 backdrop-blur-sm lg:min-h-[calc(100dvh-3rem)] lg:rounded-[2rem]">
      <ScreenHeader title={t("book.title")} subtitle={madeService ? text(madeService.name) : service ? text(service.name) : undefined} />
      {made && madeService ? (
        <BookingOutcome
          made={made}
          service={madeService}
          onStatus={(status) => setMade({ ...made, status })}
          onAgain={() => {
            setMade(null);
            onService(madeService.id);
          }}
          onAnother={() => {
            setMade(null);
            onService("");
          }}
          onHome={() => {
            setMade(null);
            go("home");
          }}
        />
      ) : service ? (
        <BookingForm key={service.id} service={service} canChange={services.length > 1} onChange={() => onService("")} onBooked={setMade} />
      ) : services.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">{t("book.noServices")}</p>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-5 sm:px-6">
          <h2 className="text-sm font-semibold text-slate-600">{t("book.chooseService")}</h2>
          <ul className="flex flex-col gap-3" data-testid="book-services">
            {services.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onService(s.id)}
                  className={`${focusRing} flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-start shadow-sm ring-1 ring-slate-900/5 hover:ring-agent-300`}
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-agent-50 to-agent-100 text-agent-800">
                    <CalendarIcon size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-slate-900">{text(s.name)}</span>
                    {text(s.description) && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{text(s.description)}</span>}
                    <span className="mt-1 block text-xs font-medium text-agent-800">{facts(s).join(" · ")}</span>
                  </span>
                  <ChevronIcon size={18} className="shrink-0 text-slate-400 rtl:-scale-x-100" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BookingForm({
  service,
  canChange,
  onChange,
  onBooked,
}: {
  service: AgentService;
  canChange: boolean;
  onChange: () => void;
  onBooked: (made: MadeBooking) => void;
}) {
  const t = useAgentT();
  const { slug, surface, text, bookingToday, locale } = useAgentUi();
  const facts = useServiceFacts();
  // Fixed length: the customer picks one of the free start times. Flexible: their own time in, and optionally time out / duration.
  const fixed = service.durationMinutes !== null && !service.customerSetsEnd;

  const [date, setDate] = useState(bookingToday);
  const [day, setDay] = useState<{ date: string; info: ServiceDay | null } | null>(null);
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [duration, setDuration] = useState("");
  // How many people: the customer always says (required, no default).
  const [people, setPeople] = useState("");
  const maxPeople = service.capacity ?? 500;
  const partySize = /^\d+$/.test(people) ? Number(people) : 0;
  const peopleOk = partySize >= 1 && partySize <= maxPeople;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<AgentBookingResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Businesses with branches: the customer books at any of them, open right now or not; the day
  // and time must fit that branch's own hours (else the other branches that can take it are offered).
  const [branchOptions, setBranchOptions] = useState<{ hasBranches: boolean; branches: BranchChoice[] } | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void bookingBranchesAction(slug, surface, locale).then((options) => {
      if (cancelled) return;
      setBranchOptions(options ?? { hasBranches: false, branches: [] });
      if (options?.branches.length === 1) setBranchId(options.branches[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, surface, locale]);
  const hasBranches = branchOptions?.hasBranches ?? false;
  const branchReady = branchOptions !== null && (!hasBranches || !!branchId);
  const chosenBranch = branchOptions?.branches.find((b) => b.id === branchId) ?? null;

  useEffect(() => {
    if (!branchReady) return;
    let cancelled = false;
    void serviceDayAction(slug, surface, { serviceId: service.id, date, branchId }).then((info) => {
      if (!cancelled) setDay({ date: `${date}|${branchId ?? ""}`, info });
    });
    return () => {
      cancelled = true;
    };
  }, [slug, surface, service.id, date, branchId, branchReady]);
  const dayKey = `${date}|${branchId ?? ""}`;
  const info = day?.date === dayKey ? day.info : null;
  const loadingDay = day?.date !== dayKey;

  const submit = () => {
    setResult(null);
    startTransition(async () => {
      const r = await bookServiceAction(slug, surface, {
        serviceId: service.id,
        date,
        timeIn,
        timeOut: !fixed && timeOut ? timeOut : null,
        durationMinutes: !fixed && !timeOut && duration ? Number(duration) : null,
        partySize,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        notes: notes.trim() || null,
        locale: locale === "ar" || locale === "fr" ? locale : "en",
        branchId,
      });
      if (r.ok) {
        onBooked({
          bookingId: r.bookingId,
          serviceId: service.id,
          status: r.status,
          date,
          timeIn,
          endTime: r.endsAt !== null ? addMinutes(timeIn, Math.round((new Date(r.endsAt).getTime() - new Date(r.startsAt).getTime()) / 60_000)) : null,
          people: partySize,
          name: name.trim(),
          phone: phone.trim(),
          requestedAt: Date.now(),
          branchName: chosenBranch && (branchOptions?.branches.length ?? 0) > 1 ? chosenBranch.name : null,
        });
      } else setResult(r);
    });
  };
  const ready = branchReady && date && /^\d{2}:\d{2}$/.test(timeIn) && peopleOk && name.trim().length >= 2 && phone.trim().length >= 6 && !pending;
  const shownEnd = fixed && timeIn ? addMinutes(timeIn, service.durationMinutes!) : null;
  const closed = info?.hours !== undefined && info?.hours !== null && info.hours.length === 0;
  // A time typed for a flexible service, outside the chosen branch's hours that day.
  const outside = !fixed && !loadingDay && !!info && !closed && /^\d{2}:\d{2}$/.test(timeIn) && !timeWithin(timeIn, info.windows);
  const refused = !!result && !result.ok && (result.reason === "closed" || result.reason === "full");

  // The chosen branch can't take it: which of the others can (that day — at that time, when one is set).
  const severalBranches = hasBranches && (branchOptions?.branches.length ?? 0) > 1;
  const needOthers = severalBranches && !!branchId && !loadingDay && !!info && (closed || (fixed && info.slots.length === 0) || outside || refused);
  const askedTime = outside || refused ? timeIn : null;
  const othersKey = needOthers ? `${service.id}|${date}|${branchId}|${askedTime ?? ""}` : null;
  const [others, setOthers] = useState<{ key: string; list: BranchAvailability[] } | null>(null);
  useEffect(() => {
    if (!othersKey) return;
    let cancelled = false;
    void otherBranchesAction(slug, surface, { serviceId: service.id, date, time: askedTime, branchId, locale }).then((list) => {
      if (!cancelled) setOthers({ key: othersKey, list });
    });
    return () => {
      cancelled = true;
    };
  }, [othersKey, slug, surface, service.id, date, askedTime, branchId, locale]);
  const otherBranches = othersKey && others?.key === othersKey ? others.list : null;
  const moveTo = (id: string, time: string | null) => {
    setBranchId(id);
    if (time) setTimeIn(time);
    else if (fixed) setTimeIn("");
    setResult(null);
  };

  return (
    <form
      className="flex flex-col gap-5 px-4 py-5 sm:px-6"
      data-testid="agent-booking-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) submit();
      }}
    >
      {/* The registered service, shown as soon as it is chosen. */}
      <section className="rounded-3xl bg-gradient-to-br from-agent-50 to-white p-4 ring-1 ring-agent-100" data-testid="booking-service-details">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">{text(service.name)}</h2>
          {canChange && (
            <button type="button" onClick={onChange} className={`${focusRing} shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-agent-800 ring-1 ring-agent-200 hover:bg-white`}>
              {t("book.change")}
            </button>
          )}
        </div>
        {text(service.description) && <p className="mt-1 text-sm text-slate-600">{text(service.description)}</p>}
        <ul className="mt-3 flex flex-wrap gap-2">
          {facts(service).map((f) => (
            <li key={f} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-agent-900 ring-1 ring-agent-100">
              {f}
            </li>
          ))}
        </ul>
      </section>

      {hasBranches && (branchOptions?.branches.length ?? 0) > 1 && (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("book.branch")} data-testid="booking-branch-choice">
          <p className="text-xs font-semibold text-slate-600">{t("book.branch")}</p>
          {branchOptions!.branches.map((b) => (
            <label
              key={b.id}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl p-3 ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-agent-400 ${
                branchId === b.id ? "bg-agent-50 ring-agent-500" : "bg-white ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="booking-branch"
                className="sr-only"
                checked={branchId === b.id}
                onChange={() => {
                  setBranchId(b.id);
                  if (fixed) setTimeIn("");
                }}
              />
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agent-50 text-agent-700">
                <PinIcon size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{b.name}</span>
                {b.address && <span className="block text-xs text-slate-500">{b.address}</span>}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="book-date" className="text-xs font-semibold text-slate-600">
          {t("book.date")}
        </label>
        <input
          id="book-date"
          type="date"
          required
          min={bookingToday}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            if (fixed) setTimeIn("");
          }}
          className={fieldCls}
        />
        {info?.hours && info.hours.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <ClockIcon size={13} /> {t("book.openHours", { hours: info.hours.join(", ") })}
          </p>
        )}
        {closed && <p className="text-xs font-medium text-amber-700">{t("book.closedDay")}</p>}
      </div>

      {fixed ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-slate-600">{t("book.pickTime")}</p>
          {loadingDay ? (
            <p className="text-sm text-slate-400">{t("book.loadingTimes")}</p>
          ) : !info || info.slots.length === 0 ? (
            !closed && <p className="text-sm text-slate-500">{t("book.noTimes")}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("book.pickTime")} data-testid="booking-slots">
              {info.slots.map((slot) => (
                <button
                  key={slot.time}
                  type="button"
                  role="radio"
                  aria-checked={timeIn === slot.time}
                  onClick={() => setTimeIn(slot.time)}
                  className={`${focusRing} flex flex-col items-center rounded-2xl px-2 py-2.5 text-sm font-semibold ring-1 ${
                    timeIn === slot.time ? "bg-agent-700 text-white ring-agent-700" : "bg-white text-slate-800 ring-slate-200 hover:ring-agent-300"
                  }`}
                  dir="ltr"
                >
                  {slot.time}
                  {service.capacity !== null && service.capacity > 1 && slot.spotsLeft !== null && (
                    <span className={`text-[10px] font-medium ${timeIn === slot.time ? "text-white/80" : "text-slate-400"}`}>{t("book.spotsLeft", { count: slot.spotsLeft })}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {shownEnd && <p className="text-xs text-slate-500">{t("book.endsAt", { time: shownEnd })}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="book-in" className="text-xs font-semibold text-slate-600">
              {t("book.timeIn")}
            </label>
            <input id="book-in" type="time" required value={timeIn} onChange={(e) => setTimeIn(e.target.value)} className={fieldCls} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="book-out" className="text-xs font-semibold text-slate-600">
              {t("book.timeOut")} <span className="font-normal text-slate-400">({t("book.optional")})</span>
            </label>
            <input id="book-out" type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} className={fieldCls} dir="ltr" />
          </div>
          {outside && (
            <p className="col-span-2 text-xs font-medium text-amber-700" data-testid="booking-outside-hours">
              {t("book.outsideHours")}
            </p>
          )}
          {!timeOut && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <label htmlFor="book-duration" className="text-xs font-semibold text-slate-600">
                {t("book.orDuration")} <span className="font-normal text-slate-400">({t("book.optional")})</span>
              </label>
              <input
                id="book-duration"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={duration}
                placeholder={service.durationMinutes ? String(service.durationMinutes) : ""}
                onChange={(e) => setDuration(e.target.value)}
                className={fieldCls}
              />
            </div>
          )}
        </div>
      )}

      {othersKey && (
        <section className="flex flex-col gap-2 rounded-3xl bg-agent-50/60 p-4 ring-1 ring-agent-100" data-testid="booking-other-branches" aria-live="polite">
          <h3 className="text-sm font-bold text-slate-900">{askedTime ? t("book.otherBranchesAt", { time: askedTime }) : t("book.otherBranches")}</h3>
          {otherBranches === null ? (
            <p className="text-sm text-slate-400">{t("book.loadingTimes")}</p>
          ) : otherBranches.length === 0 ? (
            <p className="text-sm text-slate-600" data-testid="booking-no-other-branch">
              {t("book.noOtherBranch")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {otherBranches.map((b) => (
                <li key={b.id} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200" data-testid="booking-other-branch" data-branch={b.id}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-agent-50 text-agent-700">
                      <PinIcon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">{b.name}</span>
                      {b.address && <span className="block text-xs text-slate-500">{b.address}</span>}
                      {b.hours && b.hours.length > 0 && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <ClockIcon size={12} /> {t("book.openHours", { hours: b.hours.join(", ") })}
                        </span>
                      )}
                    </span>
                    {b.times.length === 0 && (
                      <button
                        type="button"
                        onClick={() => moveTo(b.id, null)}
                        className={`${focusRing} shrink-0 rounded-full bg-agent-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-agent-800`}
                      >
                        {t("book.bookHere")}
                      </button>
                    )}
                  </div>
                  {b.times.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {b.times.map((time) => (
                        <button
                          key={time}
                          type="button"
                          onClick={() => moveTo(b.id, time)}
                          className={`${focusRing} rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-agent-800 ring-1 ring-agent-300 hover:bg-agent-50`}
                          dir="ltr"
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="book-people" className="text-xs font-semibold text-slate-600">
          {t("book.people")} <span className="text-red-600" aria-hidden>*</span>
        </label>
        <input
          id="book-people"
          type="number"
          inputMode="numeric"
          required
          min={1}
          max={maxPeople}
          value={people}
          placeholder={t("book.peoplePlaceholder")}
          onChange={(e) => setPeople(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
          aria-invalid={people !== "" && !peopleOk}
          className={fieldCls}
          data-testid="booking-people"
        />
        {people !== "" && !peopleOk && <p className="text-xs font-medium text-red-700">{t("book.peopleInvalid", { max: maxPeople })}</p>}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-bold text-slate-900">{t("book.yourDetails")}</legend>
        <Input id="book-name" label={t("book.name")} value={name} onChange={setName} autoComplete="name" />
        <Input id="book-phone" label={t("book.phone")} value={phone} onChange={setPhone} type="tel" autoComplete="tel" dir="ltr" />
        <Input id="book-email" label={`${t("book.email")} (${t("book.optional")})`} value={email} onChange={setEmail} type="email" autoComplete="email" dir="ltr" />
        <Input id="book-notes" label={`${t("book.notes")} (${t("book.optional")})`} value={notes} onChange={setNotes} />
      </fieldset>

      {result && !result.ok && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-100" data-testid="booking-error">
          {t(`book.errors.${result.reason}`)}
        </p>
      )}

      {service.requiresApproval && (
        <p className="flex items-start gap-2 rounded-2xl bg-agent-50 px-4 py-3 text-xs text-agent-900 ring-1 ring-agent-100" data-testid="booking-request-note">
          <ClockIcon size={14} className="mt-0.5 shrink-0" /> {t("book.requestNote")}
        </p>
      )}

      <button
        type="submit"
        disabled={!ready}
        className={`${focusRing} flex h-13 items-center justify-center gap-2 rounded-full bg-agent-700 text-base font-bold text-white shadow-lg shadow-agent-900/25 hover:bg-agent-800 disabled:cursor-not-allowed disabled:opacity-50`}
        lang={locale}
      >
        <CalendarIcon size={20} /> {pending ? t("book.submitting") : service.requiresApproval ? t("book.submitRequest") : t("book.submit")}
      </button>
    </form>
  );
}

function Input({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  dir,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  dir?: "ltr";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-slate-600">
        {label}
      </label>
      <input id={id} type={type} dir={dir} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} className={`${fieldCls} ${dir ? "text-start" : ""}`} />
    </div>
  );
}

/** The customer's answer: waiting for the business, confirmed, or (politely) declined. */
function BookingOutcome({
  made,
  service,
  onStatus,
  onAgain,
  onAnother,
  onHome,
}: {
  made: MadeBooking;
  service: AgentService;
  onStatus: (status: RequestStatus) => void;
  onAgain: () => void;
  onAnother: () => void;
  onHome: () => void;
}) {
  const { slug, surface } = useAgentUi();
  const { status, bookingId, requestedAt } = made;

  // While the business decides, ask every few seconds (less often as time goes on), and at once on return to the tab.
  useEffect(() => {
    if (status !== "pending") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      if (stopped) return;
      const next = await bookingStatusAction(slug, surface, bookingId).catch(() => null);
      if (stopped) return;
      if (next && next !== "pending") {
        onStatus(next);
        return;
      }
      const waited = Date.now() - requestedAt;
      timer = setTimeout(check, waited < 60_000 ? 3000 : waited < 600_000 ? 6000 : 15_000);
    };
    timer = setTimeout(check, 2500);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, slug, surface, bookingId, requestedAt, onStatus]);

  if (status === "pending") return <BookingWaiting made={made} service={service} />;
  if (status === "confirmed" || status === "completed") return <BookingDone made={made} service={service} onAnother={onAnother} onHome={onHome} />;
  return <BookingDeclined made={made} onAgain={onAgain} onHome={onHome} />;
}

function usePrettyDate() {
  const { locale } = useAgentUi();
  return (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function BookingDetails({ made, service, testId }: { made: MadeBooking; service: AgentService; testId: string }) {
  const t = useAgentT();
  const { text } = useAgentUi();
  const prettyDate = usePrettyDate();
  const rows: [string, string][] = [
    [t("book.detailService"), text(service.name)],
    ...(made.branchName ? ([[t("book.detailBranch"), made.branchName]] as [string, string][]) : []),
    [t("book.detailDate"), prettyDate(made.date)],
    [t("book.detailTime"), made.endTime ? `${made.timeIn} – ${made.endTime}` : made.timeIn],
    [t("book.detailPeople"), t("book.peopleCount", { count: made.people })],
    [t("book.detailName"), made.name],
    [t("book.detailPhone"), made.phone],
  ];
  return (
    <dl className="w-full max-w-sm divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white text-start text-sm shadow-sm ring-1 ring-slate-900/5" data-testid={testId}>
      <dt className="sr-only">{t("book.details")}</dt>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
          <dt className="text-slate-500">{label}</dt>
          <dd className="text-end font-semibold text-slate-900" dir={label === t("book.detailPhone") || label === t("book.detailTime") ? "ltr" : undefined}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "I'm checking availability…": the request is with the business, the customer waits here. */
function BookingWaiting({ made, service }: { made: MadeBooking; service: AgentService }) {
  const t = useAgentT();
  const prettyDate = usePrettyDate();
  const [long, setLong] = useState(false);
  useEffect(() => {
    const wait = Math.max(0, made.requestedAt + 5 * 60_000 - Date.now());
    const timer = setTimeout(() => setLong(true), wait);
    return () => clearTimeout(timer);
  }, [made.requestedAt]);
  return (
    <div className="flex flex-col items-center gap-6 px-5 pt-10 pb-10 text-center" data-testid="booking-waiting" aria-live="polite">
      {/* Calm, looping "we're on it": ripples around the calendar, a dot circling it. */}
      <div className="relative flex h-36 w-36 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-agent-300/50 motion-safe:animate-agent-ripple" />
        <span className="absolute inset-0 rounded-full bg-agent-300/40 motion-safe:animate-agent-ripple" style={{ animationDelay: "0.8s" }} />
        <span className="absolute inset-0 rounded-full bg-agent-300/30 motion-safe:animate-agent-ripple" style={{ animationDelay: "1.6s" }} />
        <span className="absolute inset-3 rounded-full motion-safe:animate-agent-orbit">
          <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-agent-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]" />
        </span>
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-agent-500 to-agent-700 text-white shadow-xl shadow-agent-700/30">
          <CalendarIcon size={34} />
        </span>
      </div>

      <div className="flex w-full max-w-sm items-start gap-2.5 text-start">
        <AgentAvatar size={34} online />
        <p className="rounded-3xl rounded-ss-md bg-white px-4 py-3 text-[15px] leading-snug font-medium text-slate-800 shadow-sm ring-1 ring-slate-900/5" data-testid="booking-checking">
          {t("book.checking", { date: prettyDate(made.date), time: made.timeIn, people: t("book.peopleCount", { count: made.people }) })}
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm font-semibold text-agent-800">
        {t("book.checkingWait")}
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-agent-600 motion-safe:animate-agent-dot" style={{ animationDelay: `${i * 160}ms` }} />
          ))}
        </span>
      </div>

      <BookingDetails made={made} service={service} testId="booking-request-details" />
      <p className="max-w-sm text-xs text-slate-500">{long ? t("book.checkingLong", { phone: made.phone }) : t("book.checkingNote")}</p>
    </div>
  );
}

function BookingDone({ made, service, onAnother, onHome }: { made: MadeBooking; service: AgentService; onAnother: () => void; onHome: () => void }) {
  const t = useAgentT();
  return (
    <div className="flex flex-col items-center gap-5 px-5 pt-10 pb-10 text-center" data-testid="booking-confirmed">
      <span className="motion-safe:animate-agent-pop flex h-20 w-20 items-center justify-center rounded-full bg-agent-500 text-white shadow-xl shadow-agent-500/40">
        <CheckIcon size={40} strokeWidth={2.6} />
      </span>
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">{t("book.confirmed")}</h2>
        <p className="mt-1 text-sm font-semibold text-slate-700">{t("book.seeYou", { name: made.name.split(" ")[0] })}</p>
      </div>
      <BookingDetails made={made} service={service} testId="booking-details" />
      <p className="rounded-2xl bg-slate-50 px-4 py-2 text-xs text-slate-500 ring-1 ring-slate-100">
        {t("book.ref")}: <span className="font-mono font-semibold text-slate-800">{made.bookingId.slice(0, 8).toUpperCase()}</span>
      </p>
      <div className="flex w-full max-w-sm flex-col gap-2.5">
        <button type="button" onClick={onHome} className={`${focusRing} flex h-12 items-center justify-center rounded-full bg-agent-700 text-[15px] font-bold text-white hover:bg-agent-800`}>
          {t("book.backHome")}
        </button>
        <button type="button" onClick={onAnother} className={`${focusRing} flex h-12 items-center justify-center rounded-full bg-white text-[15px] font-semibold text-agent-800 ring-1 ring-agent-200 hover:bg-agent-50`}>
          {t("book.another")}
        </button>
      </div>
    </div>
  );
}

/** Declined: a warm apology — the schedule is full at that time — and an easy way to choose another. */
function BookingDeclined({ made, onAgain, onHome }: { made: MadeBooking; onAgain: () => void; onHome: () => void }) {
  const t = useAgentT();
  const { locale } = useAgentUi();
  const prettyDate = usePrettyDate();
  return (
    <div className="flex flex-col items-center gap-5 px-5 pt-10 pb-10 text-center" data-testid="booking-declined">
      <span className="motion-safe:animate-agent-pop flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-amber-600 shadow-lg shadow-amber-500/20">
        <CalendarIcon size={36} />
      </span>
      <div className="max-w-sm">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">{t("book.declinedTitle")}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
          {made.name.split(" ")[0]}
          {locale === "ar" ? "، " : ", "}
          {t("book.declinedText", { date: prettyDate(made.date), time: made.timeIn })}
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2.5">
        <button type="button" onClick={onAgain} className={`${focusRing} flex h-12 items-center justify-center rounded-full bg-agent-700 text-[15px] font-bold text-white hover:bg-agent-800`}>
          {t("book.chooseAnother")}
        </button>
        <button type="button" onClick={onHome} className={`${focusRing} flex h-12 items-center justify-center rounded-full bg-white text-[15px] font-semibold text-agent-800 ring-1 ring-agent-200 hover:bg-agent-50`}>
          {t("book.backHome")}
        </button>
      </div>
    </div>
  );
}
