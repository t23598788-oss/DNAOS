/**
 * GET /api/v1/spec
 *
 * Public — ไม่ต้องใช้ token
 * ส่งคืน tool spec ในรูปแบบ OpenAI function-calling / Claude tool-use
 * ให้ AI ภายนอกโหลดแล้วรู้ว่า DNA OS มี tool อะไรบ้าง
 */

import { NextResponse } from "next/server"
import { buildReadOnlyToolSpec } from "../_lib/tool-spec"

export async function GET() {
  const tools = buildReadOnlyToolSpec()

  return NextResponse.json(
    {
      schema_version: "1.0",
      system: "DNA OS",
      description: "DNA OS integration API — public machine-readable tool catalog for AI clients; authenticated query requests go through the registered command dispatcher.",
      query_endpoint: "/api/v1/query",
      discovery_endpoint: "/api/v1/discovery",
      route_map_endpoint: "/api/v1/route-map",
      documentation_url: "/developers#api-entry",
      auth: "X-DNA-Token header. Create an account-bound token at /admin/api-tokens in an admin-tier session. Do not send tokens in query strings.",
      query_policy: "Commands requiring human confirmation are rejected by the dispatcher.",
      observer_url: "/observer",
      tools,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    }
  )
}
