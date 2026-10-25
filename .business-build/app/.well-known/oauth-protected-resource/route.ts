/**
 * GET /.well-known/oauth-protected-resource — RFC 9728 Protected Resource
 * Metadata. Public, no auth. Tells an MCP client which Authorization
 * Server(s) it must use to reach the resource named here.
 */
import { NextResponse } from "next/server"
import { appOrigin, canonicalMcpResourceUri } from "@/services/ai-connection/resourceConfig"

export async function GET() {
  return NextResponse.json(
    {
      resource: canonicalMcpResourceUri(),
      authorization_servers: [appOrigin()],
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  )
}
