import "server-only";

import { dayWindows, timeWithin, windowLabels } from "@/lib/branch-hours";
import { getAvailableSlots } from "@/server/commerce/booking";
import { openBranchChoices } from "@/server/commerce/branch-choice";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Other branches where a service can be booked when the customer's chosen
 * branch can't take it (closed that day, outside its hours, or full).
 * Customers can book at any active branch at any time; what they book must
 * fit that branch's own hours and free capacity — read from the database
 * (`service_slots` for fixed-length services, the branch's hours for
 * flexible ones), never invented.
 */
export type BranchAvailability = {
  id: string;
  name: string;
  address: string | null;
  /** That day's hours ("09:00–17:00"); null = the branch set no hours. */
  hours: string[] | null;
  /** Free start times (fixed-length services): the asked time if free there, else the first few. */
  times: string[];
};

type ServiceShape = { id: string; duration_minutes: number | null; customer_sets_end: boolean };

const MAX_TIMES = 6;

export async function bookingAlternatives(
  supabase: TypedSupabaseClient,
  tenantId: string,
  service: ServiceShape,
  date: string,
  /** The local start time asked for ("HH:MM"), if any. */
  time: string | null,
  excludeBranchId: string | null,
  locale: string,
): Promise<BranchAvailability[]> {
  const branches = (await openBranchChoices(supabase, tenantId, "booking", locale)).filter((b) => b.id !== excludeBranchId);
  if (branches.length === 0) return [];
  const { data: rows } = await supabase
    .from("branches")
    .select("id, opening_hours")
    .eq("tenant_id", tenantId)
    .in(
      "id",
      branches.map((b) => b.id),
    );
  const hoursById = new Map((rows ?? []).map((r) => [r.id, r.opening_hours]));
  const fixed = service.duration_minutes !== null && !service.customer_sets_end;

  const results = await Promise.all(
    branches.map(async (b): Promise<BranchAvailability | null> => {
      const windows = dayWindows(hoursById.get(b.id), date);
      if (windows !== null && windows.length === 0) return null;
      const base = { id: b.id, name: b.name, address: b.address, hours: windowLabels(windows) };
      if (!fixed) {
        // Flexible length: the branch is open that day (at the asked time, when one was given).
        return time && !timeWithin(time, windows) ? null : { ...base, times: [] };
      }
      const slots = (await getAvailableSlots(supabase, tenantId, { id: service.id }, date, b.id)).map((s) => s.localTime);
      if (time) return slots.includes(time) ? { ...base, times: [time] } : null;
      return slots.length > 0 ? { ...base, times: slots.slice(0, MAX_TIMES) } : null;
    }),
  );
  return results.filter((r): r is BranchAvailability => r !== null);
}
