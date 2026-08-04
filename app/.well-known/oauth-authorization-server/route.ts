/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 Authorization
 * Server Metadata. Public, no auth. DNA OS acts as its own Authorization
 * Server (same origin as the Resource Server — permitted by the MCP
 * Authorization spec).
 */
import { NextResponse } from "next/server"
import { appOrigin } from "@/services/ai-connection/resourceConfig"

export async function GET() {
  const origin = appOrigin()
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  )
}
