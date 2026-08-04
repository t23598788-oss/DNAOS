/**
 * POST /oauth/token — token endpoint for both grant types. No auth header
 * required (public client, token_endpoint_auth_method=none) — PKCE
 * (authorization_code grant) and possession of the refresh token
 * (refresh_token grant) are the real protections.
 */
import { NextRequest, NextResponse } from "next/server"
import { exchangeAuthorizationCode, refreshTokenGrant, OAuthError } from "@/services/ai-connection/oauth"

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }
}

export async function POST(req: NextRequest) {
  let body: Record<string, string>
  const contentType = req.headers.get("content-type") ?? ""
  try {
    if (contentType.includes("application/json")) {
      body = await req.json()
    } else {
      const form = await req.formData()
      body = Object.fromEntries(form.entries()) as Record<string, string>
    }
  } catch {
    return NextResponse.json({ error: "invalid_request", error_description: "malformed body" }, { status: 400, headers: corsHeaders() })
  }

  const grantType = body.grant_type

  try {
    if (grantType === "authorization_code") {
      const { code, client_id, redirect_uri, code_verifier, resource } = body
      if (!code || !client_id || !redirect_uri || !code_verifier || !resource) {
        return NextResponse.json({ error: "invalid_request", error_description: "missing required parameter" }, { status: 400, headers: corsHeaders() })
      }
      const tokens = await exchangeAuthorizationCode({ code, clientId: client_id, redirectUri: redirect_uri, codeVerifier: code_verifier, resource })
      return NextResponse.json(tokens, { headers: corsHeaders() })
    }

    if (grantType === "refresh_token") {
      const { refresh_token, client_id, resource } = body
      if (!refresh_token || !client_id || !resource) {
        return NextResponse.json({ error: "invalid_request", error_description: "missing required parameter" }, { status: 400, headers: corsHeaders() })
      }
      const tokens = await refreshTokenGrant({ refreshToken: refresh_token, clientId: client_id, resource })
      return NextResponse.json(tokens, { headers: corsHeaders() })
    }

    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400, headers: corsHeaders() })
  } catch (err) {
    if (err instanceof OAuthError) {
      return NextResponse.json({ error: err.code, error_description: err.message }, { status: 400, headers: corsHeaders() })
    }
    // Never leak internal error detail (e.g. DB error text) to the client.
    console.error("[oauth/token] unexpected error:", err)
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: corsHeaders() })
  }
}
