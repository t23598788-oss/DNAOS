/**
 * POST /api/brain
 * ตอบคำถามจากข้อมูลระบบจริงเท่านั้น — สองทาง:
 *   1. คำถามเกี่ยวกับธุรกิจจริง (หนี้/งาน) → การ์ดผลกระทบจาก getBusinessImpact() (DB จริง)
 *   2. คำถามเกี่ยวกับตัวระบบเอง (สถานะ/ค่าใช้จ่าย/ช่องว่าง) → answerQuestion() จาก dbd.ts (registry จริง)
 * ห้ามเดา — ถ้าไม่มี pattern ตรงจะบอกตรงๆ ว่ายังตอบไม่ได้
 */

import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/runtime/dbd";
import { getBusinessImpact, type ImpactCard } from "@/lib/v3-engines/impact/engine";

const BUSINESS_PATTERN = /หนี้|ลูกหนี้|บ่อทราย|บ่อดิน|งาน|จ่ายหนี้|ลูกค้า|เก็บเงิน|ผลกระทบ|impact/;

export async function POST(request: Request) {
  try {
    const { question } = await request.json();
    const q = String(question ?? "").trim();
    if (!q) {
      return NextResponse.json({ answer: "พิมพ์คำถามมาก่อนครับ", matched: false }, { status: 400 });
    }

    if (BUSINESS_PATTERN.test(q.toLowerCase())) {
      const cards: ImpactCard[] = await getBusinessImpact();
      const hasAlert = cards.some((c) => c.severity === "high");
      return NextResponse.json({ cards, matched: true, hasAlert });
    }

    const { answer, matched } = answerQuestion(q);
    return NextResponse.json({ answer, matched });
  } catch (error) {
    return NextResponse.json(
      { answer: `ผิดพลาด: ${error instanceof Error ? error.message : String(error)}`, matched: false },
      { status: 500 }
    );
  }
}
