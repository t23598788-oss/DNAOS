/**
 * POST /api/admin/ide/command — { text } — the Owner Command Surface
 * (owner, 2026-08-07, /admin/ide Foundation). Real, deterministic intent
 * routing only — see commandSurfaceRuntime.ts's header for exactly what
 * this does and does not do (never freeform chat, never arbitrary shell
 * text, never a Step auto-start).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { handleOwnerCommand } from "../_lib/commandSurfaceRuntime";

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { text?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "real, non-empty text is required" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "text exceeds 2000 chars" }, { status: 400 });
  const result = await handleOwnerCommand(text, auth.email, auth.id);
  return NextResponse.json({ ok: true, result });
}
