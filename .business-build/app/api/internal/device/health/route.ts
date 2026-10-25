/**
 * POST /api/internal/device/health — device heartbeat (header:
 * x-dnaos-device-token). Auth = the device's OWN token (sha256 → paired row,
 * revoked/account-deleted → 401/403), then:
 *   1. records machine facts (OS/version/arch/CPU/RAM/disk-free/node/tools)
 *      — hardware inventory ONLY, never file contents (rule3),
 *   2. re-reads the paired account's role (install ≠ permanent right),
 *   3. returns allowlisted server→device commands (consumed once) + the
 *      grants the device currently holds.
 * The token is never logged or echoed.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/queries";
import { authenticateDevice, recordDeviceHealth, type HealthInput } from "@/app/api/admin/devices/_lib/deviceRegistry";

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-dnaos-device-token") ?? "";
  const auth = await authenticateDevice(supabaseAdmin(), token);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, code: auth.status === 409 ? "META_TABLES_MISSING" : "UNAUTHORIZED", error: auth.error }, { status: auth.status });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<HealthInput>;
  const health: HealthInput = {
    os: typeof body.os === "string" ? body.os : undefined,
    osRelease: typeof body.osRelease === "string" ? body.osRelease : undefined,
    arch: typeof body.arch === "string" ? body.arch : undefined,
    cpuCount: typeof body.cpuCount === "number" ? body.cpuCount : undefined,
    ramBytes: typeof body.ramBytes === "number" ? body.ramBytes : undefined,
    diskFreeBytes: typeof body.diskFreeBytes === "number" ? body.diskFreeBytes : undefined,
    nodeVersion: typeof body.nodeVersion === "string" ? body.nodeVersion : undefined,
    tools: body.tools && typeof body.tools === "object" ? body.tools : undefined,
  };
  try {
    const { pendingCommand } = await recordDeviceHealth(supabaseAdmin(), auth.device.id, health);
    return NextResponse.json({
      ok: true,
      device_id: auth.device.id,
      grants: auth.device.grants,
      account_role: auth.accountRole,
      commands: pendingCommand ? [{ type: pendingCommand }] : [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    console.error("[device health] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
