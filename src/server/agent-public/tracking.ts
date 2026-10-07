"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { isRateLimited } from "@/server/shared/rate-limit";

import { loadOrderTracking, type OrderTracking } from "./tracking-data";

/** The same, re-read every few seconds by the open page. */
export async function orderTrackingAction(orderId: string): Promise<OrderTracking | null> {
  if (!z.uuid().safeParse(orderId).success) return null;
  const caller = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  // A page polls about every 10 seconds; this only stops a script hammering it.
  if (isRateLimited(`track:${caller}`, 60_000, 30)) return null;
  return loadOrderTracking(orderId);
}
