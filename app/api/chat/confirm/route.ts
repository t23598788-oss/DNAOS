import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { dispatchAction } from "@/gateway/actions";

// Rule 72 confirm step for the chat secretary — the preview_token already
// carries the full payload from when cognitive/executor/index.ts called
// previewDocumentCreate(), so this goes straight to dispatchAction's execute
// mode instead of re-running the whole cognitive pipeline.
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { action, preview_token } = await request.json();
  if (!action || !preview_token) {
    return NextResponse.json({ ok: false, error: "ขาด action หรือ preview_token" }, { status: 400 });
  }

  const result = await dispatchAction({ action, mode: "execute", payload: {}, preview_token });
  return NextResponse.json(result);
}
