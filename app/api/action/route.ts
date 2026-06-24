import { NextRequest, NextResponse } from "next/server";
import { dispatchAction } from "@/lib/actions/dna-actions";
import { dispatchFind } from "@/lib/actions/find-resolver";
import type { ActionRequest } from "@/lib/actions/dna-actions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ---- FIND endpoint ----
    if (body.type === "find") {
      if (!body.domain || !body.keyword) {
        return NextResponse.json(
          { ok: false, error: "ต้องระบุ domain และ keyword" },
          { status: 400 }
        );
      }
      const result = await dispatchFind(body.domain, body.keyword);
      return NextResponse.json(result);
    }

    // ---- ACTION endpoint (preview / execute) ----
    const actionReq: ActionRequest = body;

    if (!actionReq.action || !actionReq.mode) {
      return NextResponse.json(
        { ok: false, error: "ต้องระบุ action และ mode (preview|execute)" },
        { status: 400 }
      );
    }

    if (actionReq.mode !== "preview" && actionReq.mode !== "execute") {
      return NextResponse.json(
        { ok: false, error: "mode ต้องเป็น preview หรือ execute" },
        { status: 400 }
      );
    }

    const result = await dispatchAction(actionReq);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "internal error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
