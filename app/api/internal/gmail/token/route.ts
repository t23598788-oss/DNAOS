/**
 * POST /api/internal/gmail/token — Gmail credential bridge (owner-approved Phase 2)
 *
 * Supabase Edge Functions (Deno) cannot import core/connector-loader.ts, so
 * supabase/functions/_shared/gmail-client.ts now calls this narrowly-scoped,
 * secret-gated server route instead of reading GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET /
 * GMAIL_REFRESH_TOKEN from Deno env — same Edge→Node bridge pattern as
 * app/api/internal/line/command, app/api/internal/openclaw/command and
 * app/api/internal/equipment/lock-command. This makes the existing connector
 * lifecycle (Connect → Register → Test → Enable → Run, registry/connector-lifecycle.json)
 * the authorization source for Gmail read-only access instead of raw Deno secrets.
 *
 * Resolution + Run-gate rules (no second connector registry, no second OAuth flow):
 *   - The Gmail connector is resolved through the canonical loader
 *     (listConnectorsByAuthType("oauth") → Gmail-specific signal match), never by
 *     a full hardcoded generated slug — same prefix-resolution pattern as
 *     scripts/register-github-oauth-connector.ts's already-registered check.
 *   - Zero or multiple matching Gmail OAuth connectors → NOT_CONFIGURED / AMBIGUOUS —
 *     never a guess (Rule 11: the lifecycle has no exceptions, including "guessing").
 *   - requireConnector() is the Run gate: status must be "connected" AND
 *     enabled=true (Connect→Register→Test→Enable all passed), else rejected.
 *   - OAuth material is read only from the connector record returned by the
 *     canonical loader; refresh persists through the EXISTING gateway writer
 *     (gateway/connectors.ts updateConnector — Guard A), never the table directly.
 *   - Fail closed everywhere: absent/mismatched internal secret, missing connector,
 *     missing OAuth material, or a failed Google refresh all return structured
 *     errors — no env fallback exists on either side of this bridge.
 *   - client_secret / refresh_token are never returned and never logged; a failed
 *     Google refresh reports the HTTP status only, never the response body.
 */

import { NextResponse } from "next/server";
import {
  requireConnector,
  ConnectorRejectedError,
  listConnectorsByAuthType,
} from "@/core/connector-loader";
import { updateConnector } from "@/gateway/connectors";
import { supabaseAdmin } from "@/services/supabase/queries";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Treat tokens expiring within the next minute as expired — the caller still has
// to spend network time reaching Gmail itself.
const EXPIRY_MARGIN_MS = 60 * 1000;

interface TokenSuccess {
  ok: true;
  access_token: string;
  expires_at: string;
  connector_id: string;
  mailbox_email: string | null;
}
interface TokenError {
  ok: false;
  code: string;
  error: string;
}

function errorResponse(code: string, error: string, status: number): NextResponse<TokenError> {
  return NextResponse.json({ ok: false, code, error }, { status });
}

async function tokenSuccess(accessToken: string, expiresAt: string, connectorId: string, includeMailboxIdentity: boolean) {
  // Gmail profile is read only to identify which mailbox produced evidence.
  // Failure to resolve it does not block mail observation, but ownership stays
  // unassigned until a human verifies the mailbox owner.
  let mailboxEmail: string | null = null;
  if (includeMailboxIdentity) {
    try {
      const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (profile.ok) {
        const data = await profile.json() as { emailAddress?: unknown };
        if (typeof data.emailAddress === "string") mailboxEmail = data.emailAddress.toLowerCase();
      }
    } catch {
      // Keep the connection usable; the sync reports an unresolved mailbox.
    }
  }
  return NextResponse.json({
    ok: true,
    access_token: accessToken,
    expires_at: expiresAt,
    connector_id: connectorId,
    mailbox_email: mailboxEmail,
  } satisfies TokenSuccess);
}

export async function POST(req: Request) {
  // 1. Internal bridge auth — fail closed (same pattern as openclaw/line-command bridges)
  const internalSecret = process.env.GMAIL_INTERNAL_SECRET;
  if (!internalSecret) {
    return errorResponse("INTERNAL_SECRET_NOT_SET", "GMAIL_INTERNAL_SECRET ยังไม่ได้ตั้งค่าฝั่ง Node", 500);
  }
  if (req.headers.get("x-gmail-internal-secret") !== internalSecret) {
    return errorResponse("UNAUTHORIZED", "ไม่ได้รับอนุญาต", 401);
  }
  const includeMailboxIdentity = req.headers.get("x-gmail-include-mailbox-identity") === "true";

  const db = supabaseAdmin();

  // 2. Resolve the Gmail OAuth connector through the canonical loader — never the
  //    table directly, never a full hardcoded generated slug. A record is a Gmail
  //    candidate ONLY on a Gmail-specific signal (slug "gmail"-prefixed, name
  //    exactly "gmail" after normalization, or a gmail.readonly scope in
  //    config.scope). Never from token_url alone: Drive/Calendar/Sheets share
  //    Google's OAuth token endpoint, so token_url matching would wrongly claim
  //    every Google connector as Gmail.
  let candidates;
  try {
    const oauthConnectors = await listConnectorsByAuthType(db, "oauth");
    candidates = (oauthConnectors ?? []).filter((c) => {
      if (c.slug.startsWith("gmail")) return true;
      const normalizedName = (c.name ?? "").trim().toLowerCase();
      if (normalizedName === "gmail") return true;
      const cfg = c.config as Record<string, unknown> | null;
      const scope = typeof cfg?.scope === "string" ? cfg.scope : "";
      return (
        scope.includes("gmail.readonly") ||
        scope.includes("https://www.googleapis.com/auth/gmail.readonly")
      );
    });
  } catch (e) {
    return errorResponse("RESOLVE_FAILED", e instanceof Error ? e.message : String(e), 500);
  }
  if (candidates.length === 0) {
    return errorResponse(
      "NOT_CONFIGURED",
      "ไม่พบ Gmail OAuth Connector — ต้อง Register ผ่าน Connect lifecycle ก่อน (หน้า /admin/connectors)",
      404,
    );
  }
  if (candidates.length > 1) {
    return errorResponse(
      "AMBIGUOUS_GMAIL_CONNECTOR",
      `พบ ${candidates.length} OAuth connectors ที่ตรงกับ Gmail — ต้องชี้ขาดว่า connector ใดคือตัวจริงก่อน`,
      409,
    );
  }
  const resolved = candidates[0];

  // 3. Run gate — the lifecycle's Run stage (status=connected && enabled=true),
  //    also writes the real run/run_rejected lifecycle audit events
  let record;
  try {
    record = await requireConnector(db, resolved.slug, "internal/gmail/token");
  } catch (e) {
    if (e instanceof ConnectorRejectedError) {
      return errorResponse("CONNECTOR_NOT_RUNNABLE", e.message, 409);
    }
    return errorResponse("GATE_FAILED", e instanceof Error ? e.message : String(e), 500);
  }

  const config = record.config as Record<string, unknown> | null;
  const secret = (record.secret ?? {}) as Record<string, unknown>;
  const clientId = typeof config?.client_id === "string" ? config.client_id : "";
  const clientSecret = typeof secret.client_secret === "string" ? secret.client_secret : "";
  const refreshToken = typeof secret.refresh_token === "string" ? secret.refresh_token : "";
  if (!clientId || !clientSecret || !refreshToken) {
    return errorResponse(
      "NOT_CONFIGURED",
      "Gmail connector ขาด OAuth material (client_id / client_secret / refresh_token) — ต้อง authorize ให้ครบก่อน",
      404,
    );
  }

  // 4. Still-valid access_token → return it as-is (shortest path, no Google call)
  const expiresAtRaw = typeof secret.expires_at === "string" ? secret.expires_at : null;
  const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
  const accessToken = typeof secret.access_token === "string" ? secret.access_token : "";
  if (accessToken && expiresAtRaw && Number.isFinite(expiresAtMs) && expiresAtMs - EXPIRY_MARGIN_MS > Date.now()) {
    return tokenSuccess(accessToken, expiresAtRaw, record.id, includeMailboxIdentity);
  }

  // 5. Expired/missing → Google's existing refresh-token grant
  let tokenRes: Response;
  try {
    tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (e) {
    return errorResponse("GOOGLE_TOKEN_FAILED", e instanceof Error ? e.message : String(e), 502);
  }
  if (!tokenRes.ok) {
    // Status only — never echo the response body (could contain token material)
    return errorResponse("GOOGLE_TOKEN_FAILED", `Google token endpoint ตอบกลับ HTTP ${tokenRes.status}`, 502);
  }
  const tokenBody = (await tokenRes.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; refresh_token?: string }
    | null;
  const newAccessToken = tokenBody?.access_token;
  if (!newAccessToken) {
    return errorResponse("GOOGLE_TOKEN_FAILED", "Google ไม่คืน access_token", 502);
  }
  const newExpiresAt = tokenBody?.expires_in
    ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString();

  // 6. Persist through the EXISTING gateway writer (Guard A — never write the
  //    connectors table directly). updateConnector merges over the existing secret,
  //    so when Google does not return a new refresh_token the old one survives.
  try {
    await updateConnector(record.id, {
      secret: {
        access_token: newAccessToken,
        expires_at: newExpiresAt,
        ...(tokenBody?.refresh_token ? { refresh_token: tokenBody.refresh_token } : {}),
      },
    });
  } catch (e) {
    return errorResponse("PERSIST_FAILED", e instanceof Error ? e.message : String(e), 500);
  }

  // client_secret / refresh_token never leave this route — only the short-lived access token
  return tokenSuccess(newAccessToken, newExpiresAt, record.id, includeMailboxIdentity);
}
