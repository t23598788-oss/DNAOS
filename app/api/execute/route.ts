import { NextRequest, NextResponse } from "next/server";
import { execute } from "@/lib/executor/executor";
import type { ExecuteRequest } from "@/lib/executor/executor";

export async function POST(req: NextRequest) {
  try {
    const body: ExecuteRequest = await req.json();

    if (!body.tool_id || !body.action) {
      return NextResponse.json({ ok: false, error: "ต้องระบุ tool_id และ action" }, { status: 400 });
    }

    if (!body.confirmed) {
      return NextResponse.json({ ok: false, error: "ต้อง confirmed: true — มนุษย์ต้องยืนยันก่อน execute" }, { status: 403 });
    }

    const result = await execute(body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "internal error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
