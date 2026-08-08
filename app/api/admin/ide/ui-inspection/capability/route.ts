/**
 * GET /api/admin/ide/ui-inspection/capability — real, live-computed
 * UI_INSPECTION Capability Declaration (owner, 2026-08-06, Software
 * Factory Step 6). Status (NOT_IMPLEMENTED/PARTIAL/IMPLEMENTED) is
 * computed from the real Inspection Type Registry every call — never
 * hand-claimed 100%.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getUiInspectionCapability } from "../../_lib/uiInspectionCapability";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, capability: getUiInspectionCapability() });
}
