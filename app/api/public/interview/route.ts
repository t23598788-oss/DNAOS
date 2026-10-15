/**
 * AI INTERVIEW (/api/public/interview) — owner directive 2026-10-15 (PHASE 4)
 *
 * AI ช่วย "แยก/เตือน/เสนอ" เท่านั้น — ห้ามสร้างข้อเท็จจริงเอง ห้ามบันทึกอะไรลง DB:
 *   · ชื่อวัสดุ: resolveMaterial จาก engines เดิม (ตรงทะเบียน material_types เท่านั้น)
 *   · จำนวน/หน่วย/ราคา: แยกจากข้อความจริง — ไม่พบ = แจ้ง missing (ระบบไม่แต่งราคา)
 *   · สถานที่: geocoding เดิม (fail-closed เมื่อไม่ได้ตั้งค่า key — ไม่เดาพิกัด)
 *   · ตรวจข้อมูลที่ขาด + เสนอลงช่อง suggestions — ผู้ลงทะเบียนยืนยันเอง
 *     ก่อนบันทึก (บันทึกเกิดเฉพาะผ่าน /api/public/resources ที่ ownership-gated)
 */
import { NextResponse } from "next/server";
import { interviewExtract } from "@/engines/public-registry/service";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { message?: string } | null;
  if (!body?.message?.trim()) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ message ที่ต้องการให้ AI ช่วยแยก" }, { status: 400 });
  }
  const result = await interviewExtract(body.message);
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  // ไม่มีการเขียน DB ในเส้นนี้เลย — คืนข้อเสนออย่างเดียว
  return NextResponse.json(result);
}
