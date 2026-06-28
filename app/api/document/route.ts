import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { generateDoc, type DocData } from "@/lib/documents/engine";

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const data: DocData = await req.json();
  if (!data.type || !data.customer?.name || !data.items?.length) {
    return NextResponse.json({ error: "ต้องระบุ type, customer.name, items" }, { status: 400 });
  }
  const result = generateDoc(data);
  return NextResponse.json(result);
}
