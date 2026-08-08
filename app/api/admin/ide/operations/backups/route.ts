/**
 * GET /api/admin/ide/operations/backups — real, discovered backup list
 * (owner, 2026-08-08, Software Factory Step 12.5). Read-only — never
 * triggers a real backup.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { discoverBackups, listBackupPlan } from "../../_lib/backupRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, backups: discoverBackups(), plan: listBackupPlan() });
}
