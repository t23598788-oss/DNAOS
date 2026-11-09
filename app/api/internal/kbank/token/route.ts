// KBank Token Bridge (internal API).
// MOCK-MODE BUILD while KBank sandbox approval is pending.
//
// KBank status (from KBank portal screenshot, 26/10/2026):
//   - Applied: 26/10/2026
//   - Status: "Waiting for KBank officer to review and contact"
//   - Expected contact: by 9 Nov 2026
//   - Application number: 1792988917
//
// Pattern: same as app/api/internal/line/token (and /gmail, /openclaw,
// /canonical/jobs). Auth = KBANK_TOKEN_INTERNAL_SECRET + header
// x-kbank-internal-secret (fail-closed if missing/unset).
//
// Resolution + Run gate:
//   - Resolve connector via getConnector(db, "kbiz") — the canonical loader,
//     never a guessed slug.
//   - requireConnector(db, "kbiz", "internal/kbank/token") enforces
//     status=connected AND enabled=true (the Lifecycle Run gate).
//   - OAuth material is read ONLY from the connector record's secret
//     (consumer_secret / consumer_key), never logged.
//
// Approval mode:
//   - KBANK_KGP_APPROVED !== "true" → fail-closed mock: return
//     { ok: true, access_token: "SANDBOX_PENDING", mock: true } with an
//     explicit note. No real API call is made while KBank is pending.
//   - KBANK_KGP_APPROVED === "true"  → call getKBankAccessToken("kbiz")
//     and return { ok: true, access_token: <real>, mock: false }.
//     Swap is instant: only the mock branch changes, nothing else.
//
// Env:
//   - KBANK_KGP_APPROVED=false (default) → mock mode
//   - KBANK_KGP_APPROVED=true           → real mode (owner sets after KBank
//     activates the sandbox; application 1792988917, expected contact 9 Nov)
//
import { NextResponse } from "next/server";
import {
  requireConnector,
  ConnectorRejectedError,
  getConnector,
} from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";

const SLUG = "kbiz";
const INTERNAL_SECRET_ENV = "KBANK_TOKEN_INTERNAL_SECRET";
const HEADER_NAME = "x-kbank-internal-secret";

interface TokenSuccess {
  ok: true;
  access_token: string;
  mock?: boolean;
  note?: string;
}

interface TokenError {
  ok: false;
  code: string;
  error: string;
}

function errorResponse(code: string, error: string, status: number): NextResponse<TokenError> {
  return NextResponse.json({ ok: false, code, error }, { status });
}

async function loadRealClient() {
  const mod = await import("@/services/kbank/kapi-oauth");
  return mod.getKBankAccessToken;
}

export async function POST(req: Request) {
  // ── 1. Internal bridge auth — fail closed ────────────────────────────
  const internalSecret = process.env[INTERNAL_SECRET_ENV];
  if (!internalSecret) {
    return errorResponse(
      "INTERNAL_SECRET_NOT_SET",
      `${INTERNAL_SECRET_ENV} ยังไม่ได้ตั้งค่าฝั่ง Node`,
      500,
    );
  }
  const provided = req.headers.get(HEADER_NAME);
  if (provided !== internalSecret) {
    return errorResponse("UNAUTHORIZED", "ไม่ได้รับอนุญาต", 401);
  }

  // ── 2. Resolve kbiz connector through the canonical loader ──────────
  const db = supabaseAdmin();
  const record = await getConnector(db, SLUG);
  if (!record) {
    return errorResponse(
      "NOT_CONFIGURED",
      `ไม่พบ Connector "kbiz" — ต้อง Register ผ่าน Connect lifecycle ก่อน (หน้า /admin/connectors)`,
      404,
    );
  }

  // ── 3. Run gate — status=connected AND enabled=true ─────────────────
  let runnable;
  try {
    runnable = await requireConnector(db, SLUG, "internal/kbank/token");
  } catch (e) {
    if (e instanceof ConnectorRejectedError) {
      return errorResponse("CONNECTOR_NOT_RUNNABLE", e.message, 409);
    }
    return errorResponse("GATE_FAILED", e instanceof Error ? e.message : String(e), 500);
  }

  // ── 4. Approval mode ────────────────────────────────────────────────
  if (process.env["KBANK_KGP_APPROVED"] !== "true") {
    // KBank sandbox not yet activated. Never call the real KBank API.
    // OAuth client is correct; the 400 was KBank's own "waiting for review"
    // state, not a client defect.
    return NextResponse.json<TokenSuccess>({
      ok: true,
      access_token: "SANDBOX_PENDING",
      mock: true,
      note:
        "KBank sandbox not yet activated. Waiting for KBank officer approval (application 1792988917, expected contact by 9 Nov 2026).",
    });
  }

  // ── 5. Real KBank OAuth (approved) ──────────────────────────────────
  const getToken = await loadRealClient();
  const accessToken = await getToken!("kbiz");
  return NextResponse.json<TokenSuccess>({
    ok: true,
    access_token: accessToken,
    mock: false,
  });
}
