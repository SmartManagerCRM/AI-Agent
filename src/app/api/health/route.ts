import { NextResponse } from "next/server";

import { anonymousClient } from "@/server/supabase/clients";

export async function GET() {
  const supabase = anonymousClient();
  const { error } = await supabase.from("business_types").select("key").limit(1);
  if (error) {
    return NextResponse.json({ status: "error", database: false }, { status: 503 });
  }
  return NextResponse.json({ status: "ok", database: true });
}
