import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getDiagnosisJSON } from "@/core/runtime/self-awareness";

// GET /api/self-description
// ระบบอธิบายตัวเองจาก Registry — ไม่ใช้ AI ไม่มี hardcoded description
// Real, live security fix (TASK-001, DNA-000070): was unauthenticated, leaked
// a full self-diagnosis of the system's real internal state.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const data = getDiagnosisJSON();
  return NextResponse.json(data);
}
