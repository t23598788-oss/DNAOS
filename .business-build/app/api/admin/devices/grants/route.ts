/**
 * Scoped Grants — the owner-controlled permission rows (deny-by-default data
 * for core/policy/scope). Step2/6:
 *  GET    → list (who has what, for the owner's review page)
 *  POST   → { op:"create", subject_type, subject_id, action, resource,
 *             job_id?, expires_at? } — only ADMIN_TIER sessions grant
 *             (granted_by = this session). AI/text can never create one:
 *             there is no other write path in the app.
 *  POST   → { op:"revoke", id } — soft revoke (revoked_at), keeps audit trail.
 * ADMIN_TIER + audit_logs on both writes. validate action against SCOPE_ACTIONS.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { SCOPE_ACTIONS, isGrantorRole, type ScopeAction } from "@/core/policy/scope";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const { data, error } = await supabaseAdmin()
      .from("scoped_grants")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, grants: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING" || /Could not find the table|schema cache/i.test(msg)) {
      return NextResponse.json({ ok: false, code: "META_TABLES_MISSING", error: "รัน migration 20260926000001 ก่อน" }, { status: 409 });
    }
    console.error("[grants] list failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  // Defense in depth: even an ADMIN_TIER session must pass the registry-derived
  // grantor rule (ai_service and friends can never sit here).
  if (!isGrantorRole(auth.role)) {
    return NextResponse.json({ ok: false, code: "NOT_GRANTOR", error: "บทบาทนี้ไม่อยู่ใน admin_tier ของ registry" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.op === "revoke") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return NextResponse.json({ ok: false, error: "ต้องระบุ id" }, { status: 400 });
      const { data, error } = await supabaseAdmin()
        .from("scoped_grants")
        .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .is("revoked_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return NextResponse.json({ ok: false, code: "CONFLICT", error: "ไม่พบ grant ที่ยังไม่ถูกเพิกถอน" }, { status: 409 });
      await supabaseAdmin().from("audit_logs").insert({
        entity_type: "scoped_grant", entity_id: id, action: "revoked", actor_user_id: auth.id,
      });
      return NextResponse.json({ ok: true, grant: data });
    }

    const subjectType = body.subject_type;
    const subjectId = typeof body.subject_id === "string" ? body.subject_id : "";
    const action = body.action;
    const resource = typeof body.resource === "string" ? body.resource : "";
    if (subjectType !== "account" && subjectType !== "device" && subjectType !== "tool") {
      return NextResponse.json({ ok: false, error: "subject_type ต้องเป็น account|device|tool" }, { status: 400 });
    }
    if (!(SCOPE_ACTIONS as readonly string[]).includes(String(action))) {
      return NextResponse.json({ ok: false, error: `action ต้องเป็นหนึ่งใน ${SCOPE_ACTIONS.join("|")}` }, { status: 400 });
    }
    if (!subjectId || !resource) {
      return NextResponse.json({ ok: false, error: "ต้องระบุ subject_id และ resource" }, { status: 400 });
    }
    const expiresAt = typeof body.expires_at === "string" && body.expires_at ? body.expires_at : null;
    if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
      return NextResponse.json({ ok: false, error: "expires_at ไม่ใช่วันที่ที่ถูกต้อง" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin()
      .from("scoped_grants")
      .insert({
        subject_type: subjectType,
        subject_id: subjectId,
        action: action as ScopeAction,
        resource,
        job_id: typeof body.job_id === "string" && body.job_id ? body.job_id : null,
        granted_by: auth.id,
        expires_at: expiresAt,
      })
      .select("*")
      .single();
    if (error) {
      if (/Could not find the table|schema cache/i.test(error.message ?? "")) {
        return NextResponse.json({ ok: false, code: "META_TABLES_MISSING", error: "รัน migration 20260926000001 ก่อน" }, { status: 409 });
      }
      throw new Error(error.message);
    }
    await supabaseAdmin().from("audit_logs").insert({
      entity_type: "scoped_grant", entity_id: (data as { id: string }).id,
      action: "granted", field: `${subjectType}:${subjectId} ${String(action)} ${resource}`, actor_user_id: auth.id,
    });
    return NextResponse.json({ ok: true, grant: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[grants] write failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
