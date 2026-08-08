/**
 * GET /api/admin/ide/execution/commands — lists the real, fixed set of
 * registered commands (id/label/description/category only — never
 * executable/fixedArgs, which stay server-internal) so the Execution panel
 * can render a real command selector instead of a free-text input (owner,
 * 2026-08-05, Phase 4).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listCommandDefinitions } from "../../_lib/executionRegistry";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const commands = listCommandDefinitions().map((d) => ({
    id: d.id, label: d.label, description: d.description, category: d.category, eventCategory: d.eventCategory,
    mode: d.mode, changesWorkspace: d.changesWorkspace, requiresOwnerConfirmation: d.requiresOwnerConfirmation,
    evidenceSource: d.evidenceSource, status: d.status,
  }));
  return NextResponse.json({ ok: true, commands });
}
