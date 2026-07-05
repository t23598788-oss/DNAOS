import { NextResponse } from "next/server";
import { getDiagnosisJSON } from "@/lib/runtime/self-awareness";

// GET /api/self-description
// ระบบอธิบายตัวเองจาก Registry — ไม่ใช้ AI ไม่มี hardcoded description
export async function GET() {
  const data = getDiagnosisJSON();
  return NextResponse.json(data);
}
