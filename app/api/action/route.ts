import { NextRequest, NextResponse } from "next/server";
import { dispatchAction } from "@/lib/actions/dna-actions";
import type { ActionRequest } from "@/lib/actions/dna-actions";

export async function POST(req: NextRequest) {
  try {
    const body: ActionRequest = await req.json();

    if (!body.action || !body.mode) {
      return NextResponse.json(
        { ok: false, error: "ต้องระบุ action และ mode (preview|execute)" },
        { status: 400 }
      );
    }

    if (body.mode !== "preview" && body.mode !== "execute") {
      return NextResponse.json(
        { ok: false, error: "mode ต้องเป็น preview หรือ execute" },
        { status: 400 }
      );
    }

    const result = await dispatchAction(body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "internal error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
