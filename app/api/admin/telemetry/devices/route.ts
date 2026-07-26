import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";

// 3D Hologram Network Topology (owner, 2026-07-26): real customer device
// markers (📱) plotted at real GPS coordinates instead of fabricated
// positions — customer_sites.gps_lat/gps_lng is populated by real LINE
// location shares (see handlers/location.ts / event-followup.ts, both
// already write real lat/lng here). No invented "user device" positions.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ devices: [] });

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("customer_sites")
    .select("id, site_name, gps_lat, gps_lng, updated_at")
    .not("gps_lat", "is", null)
    .not("gps_lng", "is", null)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(25);

  return NextResponse.json({ devices: data ?? [] });
}
