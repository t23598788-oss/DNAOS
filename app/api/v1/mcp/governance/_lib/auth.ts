import { NextResponse } from "next/server"
import { validateApiToken, serviceClient, type ApiToken } from "@/services/supabase/api-tokens"
import { OWNER_VERIFICATION_PATH, verifyOwnerArtifact } from "@/core/owner-verification-client"

/** The identity the INFRASTRUCTURE owner-authentication verified (never a claim). */
export interface OwnerVerificationContext {
  owner_identity: string
  owner_session_id: string
  verified_by: string
}

export type GovernanceAuth =
  | { ok: true; token: ApiToken; db: ReturnType<typeof serviceClient>; owner?: OwnerVerificationContext }
  | { ok: false; response: NextResponse }

/**
 * Artifact may arrive either in the JSON body (owner_verification_artifact, the
 * same field name /api/gateway/proposals/[id]/decide uses) or as a JSON header
 * for callers that must authenticate before reading a body.
 */
function artifactFromHeader(req: Request): unknown {
  const raw = req.headers.get("x-owner-verification-artifact")
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Core chain wiring (T7): `governance:propose` is a PRIVILEGED MUTATION, so a
 * valid token — including one owned by a super_admin — is permission only, never
 * owner proof. The mutation must additionally carry an artifact produced by
 * -DNA-OS-INFRASTRUCTURE-'s owner-authentication (Touch ID / device passcode,
 * single-use challenge, HMAC-signed when it crosses a runtime boundary), which
 * is verified by the infrastructure's own transport
 * (core/owner-verification-client.ts). Nothing is verified locally: an
 * unavailable/cancelled/expired verification is a typed failure and the caller
 * must not proceed (fail-closed). Read scope is unchanged — reading grants no
 * authority.
 */
export async function authenticate(
  req: Request,
  requiredScope: "read" | "governance:propose",
  ownerArtifact?: unknown,
): Promise<GovernanceAuth> {
  const raw = req.headers.get("x-dna-token")?.trim() ?? ""
  if (!raw) return { ok: false, response: NextResponse.json({ error: "X-DNA-Token required" }, { status: 401 }) }

  const token = await validateApiToken(raw)
  if (!token) return { ok: false, response: NextResponse.json({ error: "invalid or revoked DNA OS token" }, { status: 401 }) }

  const allowed = requiredScope === "read"
    ? token.scopes.includes("read") || token.scopes.includes("governance:read") || token.scopes.includes("governance:propose")
    : token.scopes.includes("governance:propose")
  if (!allowed) return { ok: false, response: NextResponse.json({ error: `token scope '${requiredScope}' required` }, { status: 403 }) }

  if (requiredScope !== "governance:propose") {
    return { ok: true, token, db: serviceClient() }
  }

  const artifact = ownerArtifact ?? artifactFromHeader(req)
  if (artifact === undefined || artifact === null || typeof artifact !== "object") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "OWNER_VERIFICATION_REQUIRED",
          transport: OWNER_VERIFICATION_PATH,
          detail:
            "a privileged mutation requires owner_verification_artifact produced by the infrastructure owner-authentication (Touch ID / device passcode); a token scope alone — including super_admin — is not owner proof",
        },
        { status: 403 }
      ),
    }
  }

  const verdict = await verifyOwnerArtifact(artifact)
  if (!verdict.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "OWNER_VERIFICATION_FAILED",
          code: verdict.code,
          detail: verdict.detail,
          http_status: verdict.http_status,
        },
        { status: verdict.http_status >= 400 && verdict.http_status < 600 ? verdict.http_status : 403 }
      ),
    }
  }

  return {
    ok: true,
    token,
    db: serviceClient(),
    owner: {
      owner_identity: verdict.owner_identity,
      owner_session_id: verdict.owner_session_id,
      verified_by: verdict.verified_by,
    },
  }
}
