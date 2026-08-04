/**
 * POST /api/admin/dev-loop/approve — Owner approves or rejects a PROPOSED
 * registry patch (dev_loop_registry_proposals). This endpoint only ever
 * flips `status` — it never writes registry/module-registry.json itself;
 * applying an approved patch stays scripts/sync-registry.ts's job, run by
 * the Owner (or a follow-up script reading approved rows) as a separate,
 * deliberate step. Same auth convention as every other /api/admin/* write.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const { id, decision } = body ?? {};
  if (!id || (decision !== "approved" && decision !== "rejected")) {
    return NextResponse.json({ error: "ต้องระบุ id และ decision ('approved' หรือ 'rejected')" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("dev_loop_registry_proposals")
    .update({ status: decision, decided_by: auth.email, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending") // never re-decide an already-decided proposal
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "proposal not found or already decided" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, proposal: data });
}
