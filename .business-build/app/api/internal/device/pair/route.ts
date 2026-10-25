/**
 * POST /api/internal/device/pair { code, health? } — the machine exchanges a
 * ONE-TIME pairing code (shown once on the admin's /admin/devices screen)
 * for ITS OWN device token (`dnad_...`). The token is returned exactly once
 * and must be stored in the OS secret store by the connector — only its
 * sha256 is kept server-side. No owner/admin/service-role secret exists in
 * this flow (rule4). Per-IP attempt limiter (same pattern as /auth/confirm).
 * NOT under /api/internal shared-secret bearer auth: possession of the
 * unexpired one-time code IS the authorization (paired by an admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/queries";
import { pairDevice, type HealthInput } from "@/app/api/admin/devices/_lib/deviceRegistry";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attemptsByIp = new Map<string, number[]>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = (attemptsByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.push(now);
  attemptsByIp.set(ip, attempts);
  return attempts.length > MAX_ATTEMPTS;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "พยายามหลายครั้งเกินไป — รอ10นาทีแล้วลองใหม่" }, { status: 429 });
  }
  const body = (await req.json().catch(() => (null))) as { code?: unknown; health?: HealthInput } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return NextResponse.json({ ok: false, error: "ต้องระบุ code" }, { status: 400 });

  try {
    const result = await pairDevice(supabaseAdmin(), { code, health: body?.health });
    if (!result.ok) {
      const status = result.code === "ATTEMPTS_EXCEEDED" ? 429 : result.code === "DEVICE_REVOKED" ? 403 : 400;
      return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status });
    }
    await supabaseAdmin().from("audit_logs").insert({
      entity_type: "device",
      entity_id: result.deviceId,
      action: "paired",
      field: "device token issued (sha256 stored)",
      actor_user_id: null,
    });
    return NextResponse.json({
      ok: true,
      device_id: result.deviceId,
      token: result.token, // ONE-TIME delivery — store in OS secret store, never re-requestable
      grants: result.grants,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code2 = (err as { code?: string }).code;
    if (code2 === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code: code2, error: msg }, { status: 409 });
    console.error("[device pair] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
