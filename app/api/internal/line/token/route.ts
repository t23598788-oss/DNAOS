/**
 * POST /api/internal/line/token — LINE credential bridge (owner, 2026-09-18)
 *
 * Supabase Edge Functions (Deno) cannot import core/connector-loader.ts, so
 * supabase/functions/_shared/line-client.ts calls this narrowly-scoped,
 * secret-gated server route instead of reading LINE_CHANNEL_ACCESS_TOKEN
 * from Deno env — the same Edge→Node bridge pattern as
 * app/api/internal/gmail/token (owner-approved Gmail Phase 2),
 * app/api/internal/line/command, app/api/internal/openclaw/command and
 * app/api/internal/equipment/lock-command. This makes the existing connector
 * lifecycle (Connect → Register → Test → Enable → Run,
 * registry/connector-lifecycle.json) the authorization source for every LINE
 * API call the Edge functions make, instead of raw Deno secrets.
 *
 * Resolution + Run-gate rules (no second connector registry):
 *   - The LINE connector is resolved through the canonical loader
 *     (getConnector by exact slug "line" — the same resolution every Node-side
 *     caller of requireConnector(db, "line", ...) uses since the LINE
 *     credential path cutover), never a guessed slug.
 *   - requireConnector() is the Run gate: status must be "connected" AND
 *     enabled=true, else rejected with the loader's own owner-facing message.
 *   - The token is read only from the connector record's secret
 *     (channel_access_token / token / api_key) and is NEVER logged. Nothing
 *     else from the record is returned.
 *   - Fail closed everywhere: absent/mismatched internal secret, missing
 *     connector, or a non-runnable connector all return structured errors —
 *     no env fallback exists on either side of this bridge.
 */

import { NextResponse } from "next/server";
import { requireConnector, ConnectorRejectedError, getConnector } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";

const SLUG = "line";

interface TokenSuccess {
  ok: true;
  access_token: string;
}
interface TokenError {
  ok: false;
  code: string;
  error: string;
}

function errorResponse(code: string, error: string, status: number): NextResponse<TokenError> {
  return NextResponse.json({ ok: false, code, error }, { status });
}

export async function POST(req: Request) {
  // 1. Internal bridge auth — fail closed (same pattern as the Gmail bridge)
  const internalSecret = process.env.LINE_INTERNAL_SECRET ?? process.env.LINE_TOKEN_INTERNAL_SECRET;
  if (!internalSecret) {
    return errorResponse("INTERNAL_SECRET_NOT_SET", "LINE_INTERNAL_SECRET/LINE_TOKEN_INTERNAL_SECRET ยังไม่ได้ตั้งค่าฝั่ง Node", 500);
  }
  if (req.headers.get("x-line-internal-secret") !== internalSecret) {
    return errorResponse("UNAUTHORIZED", "ไม่ได้รับอนุญาต", 401);
  }

  const db = supabaseAdmin();

  // 2. Resolve the "line" connector through the canonical loader — never the
  //    table directly. Missing → NOT_CONFIGURED (owner registers it at
  //    /admin/connectors), never a guess.
  const record = await getConnector(db, SLUG);
  if (!record) {
    return errorResponse(
      "NOT_CONFIGURED",
      "ไม่พบ Connector \"line\" — ต้อง Register ผ่าน Connect lifecycle ก่อน (หน้า /admin/connectors)",
      404,
    );
  }

  // 3. Run gate — the lifecycle's Run stage (status=connected && enabled=true),
  //    also writes the real run/run_rejected lifecycle audit events
  let runnable;
  try {
    runnable = await requireConnector(db, SLUG, "internal/line/token");
  } catch (e) {
    if (e instanceof ConnectorRejectedError) {
      return errorResponse("CONNECTOR_NOT_RUNNABLE", e.message, 409);
    }
    return errorResponse("GATE_FAILED", e instanceof Error ? e.message : String(e), 500);
  }

  // 4. Token from the connector record's secret only — never logged, and
  //    nothing else about the record leaves this route.
  const secret = (runnable.secret ?? {}) as Record<string, unknown>;
  const accessToken =
    (secret.channel_access_token as string) ??
    (secret.token as string) ??
    (secret.api_key as string) ??
    "";
  if (!accessToken) {
    return errorResponse(
      "NOT_CONFIGURED",
      "connector \"line\" ไม่มี channel_access_token ใน secret — แก้ที่ /admin/connectors",
      404,
    );
  }

  return NextResponse.json({ ok: true, access_token: accessToken } satisfies TokenSuccess);
}
