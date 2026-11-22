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
      description: "ERP system for concrete/logistics business — query interface for external AI",
      query_endpoint: "/api/v1/query",
      auth: "Header: X-DNA-Token: <your-token>  (GET /admin/api-tokens to generate)",
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
