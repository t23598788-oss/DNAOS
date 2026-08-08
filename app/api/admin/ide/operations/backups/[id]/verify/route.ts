/**
 * POST /api/admin/ide/operations/backups/[id]/verify — real, deterministic
 * Backup Integrity Verification (owner, 2026-08-08, Software Factory
 * Step 12.5). Never invokes a real backup — read-only against the real,
 * already-existing backup files.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { verifyBackupIntegrity } from "../../../../_lib/backupRuntime";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const report = await verifyBackupIntegrity(id, auth.id, auth.email);
  return NextResponse.json({ ok: true, report });
}
