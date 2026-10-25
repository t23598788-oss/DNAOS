/**
 * TRANSPORTER SELF-SERVICE (/api/public/transporter) — 2026-10-19
 *
 * Reuses the EXISTING tables only:
 *   driver_profiles (user_id is the bridge to the signed-in account)
 *   jobs.assigned_person_id (the assignment already recorded by the operator)
 *   vehicle_types (existing master data for the profile form)
 *
 * No new business table and no new job state machine. A transporter can see only
 * the jobs assigned to their own driver profile; an unlinked account gets an
 * empty list and is asked to create/link its profile first.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import { supabaseAdmin, getJobsAssignedToDriver } from "@/services/supabase/queries";

const TRANSPORTER_ROLES = (permissions.route_access.find((r) => r.prefix === "/transporter")?.roles ?? []) as AppRole[];

type DriverProfile = {
  id: string;
  user_id: string;
  driver_name: string | null;
  phone: string | null;
  vehicle_type_id: string | null;
  vehicle_plate_text: string | null;
  vehicle_plate_province: string | null;
  line_user_id: string | null;
};

export async function GET() {
  const auth = await requireAuth(TRANSPORTER_ROLES);
  if (auth instanceof NextResponse) return auth;

  const db = supabaseAdmin();
  const [{ data: profile, error: profileError }, { data: vehicleTypes }] = await Promise.all([
    db.from("driver_profiles")
      .select("id, user_id, driver_name, phone, vehicle_type_id, vehicle_plate_text, vehicle_plate_province, line_user_id")
      .eq("user_id", auth.id)
      .is("deleted_at", null)
      .maybeSingle(),
    db.from("vehicle_types").select("id, name, load_capacity").is("deleted_at", null).order("name"),
  ]);

  if (profileError) return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });

  let jobs: Record<string, unknown>[] = [];
  if (profile?.id) {
    try {
      jobs = await getJobsAssignedToDriver(db, profile.id);
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "jobs read failed" }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    linked: Boolean(profile?.id),
    profile: (profile ?? null) as DriverProfile | null,
    jobs,
    vehicle_types: vehicleTypes ?? [],
  });
}

export async function POST(req: Request) {
  const auth = await requireAuth(TRANSPORTER_ROLES);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    driver_name?: string;
    phone?: string;
    vehicle_type_id?: string | null;
    vehicle_plate_text?: string | null;
    vehicle_plate_province?: string | null;
  } | null;

  if (body?.action !== "save_my_driver_profile") {
    return NextResponse.json({ ok: false, error: "action ต้องเป็น save_my_driver_profile" }, { status: 400 });
  }

  const driverName = String(body.driver_name ?? "").trim();
  if (!driverName) return NextResponse.json({ ok: false, error: "ต้องระบุชื่อผู้ขับ" }, { status: 400 });
  if (driverName.length > 200) return NextResponse.json({ ok: false, error: "ชื่อผู้ขับยาวเกิน 200 ตัวอักษร" }, { status: 400 });

  const vehicleTypeId = body.vehicle_type_id ? String(body.vehicle_type_id) : null;
  const db = supabaseAdmin();
  if (vehicleTypeId) {
    const { data: vt, error } = await db.from("vehicle_types").select("id").eq("id", vehicleTypeId).maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!vt) return NextResponse.json({ ok: false, error: "vehicle_type_id ไม่พบใน vehicle_types" }, { status: 400 });
  }

  const patch = {
    driver_name: driverName,
    phone: body.phone?.trim() || null,
    vehicle_type_id: vehicleTypeId,
    vehicle_plate_text: body.vehicle_plate_text?.trim() || null,
    vehicle_plate_province: body.vehicle_plate_province?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const existing = await db.from("driver_profiles")
    .select("id")
    .eq("user_id", auth.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.error) return NextResponse.json({ ok: false, error: existing.error.message }, { status: 500 });

  if (existing.data?.id) {
    const { error } = await db.from("driver_profiles").update(patch).eq("id", existing.data.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, profile_id: existing.data.id, updated: true });
  }

  const { data: created, error } = await db.from("driver_profiles")
    .insert({ id: crypto.randomUUID(), user_id: auth.id, ...patch })
    .select("id")
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, profile_id: created.id, updated: false });
}
