/**
 * PUBLIC REGISTRATION (/api/public/register) — owner directive 2026-10-15
 *
 * เส้นทางลงทะเบียนด้วยตนเองของประชาชน/ผู้ประกอบการทั่วประเทศ (PHASE 2):
 *   · ผ่าน auth เดิมจริง (Supabase magic-link — generateLink ไม่ส่งข้อความจริง)
 *   · ผ่าน service กลาง engines/public-registry/service.ts ตัวเดียว
 *     (ตารางเดิม profiles/companies — Canonical เดิม · ห้ามซ้ำจริง)
 *   · ไม่อยู่ใน PROTECTED_API_PREFIXES — คนทั่วไปเรียกได้ แต่ทุกเรื่องยังผ่าน
 *     middleware + surface policy ของโครงเดิม
 *   · fail-closed: อีเมลซ้ำ = ALREADY_REGISTERED · บริษัทไม่มีชื่อ = ปฏิเสธ
 */
import { NextResponse } from "next/server";
import { registerNational, type RegisterInput } from "@/engines/public-registry/service";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    email?: string; display_name?: string; registration_type?: string;
    company_name?: string; phone?: string; address?: string; registrant_profile?: string;
  } | null;
  if (!body?.email || !body?.registration_type || !body?.registrant_profile) {
    return NextResponse.json(
      { ok: false, error: "ต้องระบุ email, registration_type และ registrant_profile" },
      { status: 400 },
    );
  }
  const allowedProfiles = new Set(["buyer", "resource_owner", "service_provider", "labor"]);
  if (!allowedProfiles.has(body.registrant_profile)) {
    return NextResponse.json(
      { ok: false, error: `registrant_profile ต้องเป็นหนึ่งใน: ${[...allowedProfiles].join(", ")}` },
      { status: 400 },
    );
  }
  const result = await registerNational({
    email: body.email,
    display_name: body.display_name,
    registration_type: body.registration_type === "company" ? "company" : "individual",
    company_name: body.company_name,
    phone: body.phone,
    address: body.address,
    registrant_profile: body.registrant_profile as RegisterInput["registrant_profile"],
  });
  if (!result.ok) {
    const status = result.code === "ALREADY_REGISTERED" || result.code === "DUP" ? 409 : 400;
    return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status });
  }
  // คืนลิงก์เข้าสู่ระบบครั้งเดียวให้ผู้ลงทะเบียนกดเอง — ระบบไม่ส่งข้อความจริงใด ๆ
  return NextResponse.json({ ok: true, action_link: result.action_link, profile_id: result.profile_id, company_id: result.company_id });
}
