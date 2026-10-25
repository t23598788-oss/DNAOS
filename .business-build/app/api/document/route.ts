import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { generateDoc, type DocData } from "@/engines/documents/engine";

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(ADMIN_TIER);
  if (authResult instanceof NextResponse) return authResult;

  const data: DocData = await req.json();
  if (!data.type || !data.customer?.name || !data.items?.length) {
    return NextResponse.json({ error: "ต้องระบุ type, customer.name, items" }, { status: 400 });
  }
  const result = generateDoc(data);
  return NextResponse.json(result);
}
