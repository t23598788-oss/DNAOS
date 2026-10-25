/**
 * POST /oauth/register — RFC 7591 Dynamic Client Registration. Public
 * (client_id is not a secret — PKCE + admin approval at /oauth/authorize
 * are the real protections). Open self-registration only creates a row
 * that still cannot obtain a token without an admin explicitly approving
 * an authorization request for it.
 */
import { NextRequest, NextResponse } from "next/server"
import { registerClient } from "@/services/ai-connection/oauth"

export async function POST(req: NextRequest) {
  let body: { client_name?: string; redirect_uris?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid_request", error_description: "body must be JSON" }, { status: 400 })
  }

  const clientName = String(body.client_name ?? "").trim()
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []

  if (!clientName || redirectUris.length === 0) {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "client_name and at least one redirect_uri are required" }, { status: 400 })
  }

  try {
    const { client_id } = await registerClient(clientName, redirectUris)
    return NextResponse.json({ client_id, redirect_uris: redirectUris, token_endpoint_auth_method: "none" }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: err instanceof Error ? err.message : "registration failed" }, { status: 400 })
  }
}
