import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";

// Real-Time 3D Telemetry (owner, 2026-07-26): "ลำแสงต้องวิ่งด้วยความเร็วอิงตาม
// latency จริง (ms)" — measures a real round-trip to each real external node
// in the architecture, server-side (so it isn't polluted by the admin's own
// browser/wifi latency), so GlobeView.tsx can scale beam-travel-time to a
// real measured number instead of a fixed fake animation duration.
//
// Real-world node placement (Rule: no fabricated data — these are the
// project's actual infrastructure locations, not decorative coordinates):
// - Cloud Core = this Supabase project's real AWS region, `ap-northeast-2`
//   (Seoul) — confirmed via `supabase projects list` against the linked
//   project (xeytcavxejhyzxwevgto, "D N A O S system").
// - External Services (LINE) = LINE Corp's real platform, Tokyo, Japan.
// - Local Edge (the owner's Mac) location is supplied by the caller (this
//   route can't know where the browser physically is; the page passes the
//   admin's own known real location, Khon Kaen, Thailand).
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const results: { node: string; ms: number | null; ok: boolean }[] = [];

  // Cloud Core (Supabase) — a real, cheap authenticated query, not a fake sleep.
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey);
      const start = performance.now();
      await supabase.from("ai_tasks").select("id", { count: "exact", head: true });
      results.push({ node: "cloud_core", ms: Math.round(performance.now() - start), ok: true });
    } else {
      results.push({ node: "cloud_core", ms: null, ok: false });
    }
  } catch {
    results.push({ node: "cloud_core", ms: null, ok: false });
  }

  // External Services (LINE Messaging API) — real GET against LINE's own
  // read-only bot-info endpoint, the lightest real authenticated call LINE
  // exposes (no message sent, no side effect).
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (token) {
      const start = performance.now();
      const res = await fetch("https://api.line.me/v2/bot/info", {
        headers: { Authorization: `Bearer ${token}` },
      });
      results.push({ node: "external_line", ms: Math.round(performance.now() - start), ok: res.ok });
    } else {
      results.push({ node: "external_line", ms: null, ok: false });
    }
  } catch {
    results.push({ node: "external_line", ms: null, ok: false });
  }

  return NextResponse.json({ measured_at: new Date().toISOString(), results });
}
