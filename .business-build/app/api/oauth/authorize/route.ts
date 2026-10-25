/**
 * POST /api/oauth/authorize — the real approve/deny action behind
 * /oauth/authorize. Re-validates everything server-side (never trusts the
 * hidden form fields as proof of anything) before minting an authorization
 * code. requireAuth(ADMIN_TIER) is the actual gate — the page rendering the
 * form is only a convenience, not a security boundary.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { validateRedirectUri, createAuthorizationCode } from "@/services/ai-connection/oauth"
import { canonicalMcpResourceUri } from "@/services/ai-connection/resourceConfig"

function denyRedirect(redirectUri: string, state: string, error: string) {
  const url = new URL(redirectUri)
  url.searchParams.set("error", error)
  if (state) url.searchParams.set("state", state)
  return NextResponse.redirect(url)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const form = await req.formData()
  const clientId = String(form.get("client_id") ?? "")
  const redirectUri = String(form.get("redirect_uri") ?? "")
  const codeChallenge = String(form.get("code_challenge") ?? "")
  const resource = String(form.get("resource") ?? "")
  const state = String(form.get("state") ?? "")
  const decision = String(form.get("decision") ?? "")

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "invalid_request", error_description: "missing client_id or redirect_uri" }, { status: 400 })
  }

  const redirectValid = await validateRedirectUri(clientId, redirectUri)
  if (!redirectValid) {
    return NextResponse.json({ error: "invalid_request", error_description: "redirect_uri not registered for this client" }, { status: 400 })
  }

  if (decision !== "approve") {
    return denyRedirect(redirectUri, state, "access_denied")
  }

  if (!codeChallenge || resource !== canonicalMcpResourceUri()) {
    return denyRedirect(redirectUri, state, "invalid_request")
  }

  const code = await createAuthorizationCode({
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    approvedBy: auth.id,
  })

  const url = new URL(redirectUri)
  url.searchParams.set("code", code)
  if (state) url.searchParams.set("state", state)
  return NextResponse.redirect(url)
}
