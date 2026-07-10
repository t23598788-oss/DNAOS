/**
 * GET /api/v1/spec
 *
 * Public — ไม่ต้องใช้ token
 * ส่งคืน tool spec ในรูปแบบ OpenAI function-calling / Claude tool-use
 * ให้ AI ภายนอกโหลดแล้วรู้ว่า DNA OS มี tool อะไรบ้าง
 */

import { NextResponse } from "next/server"
import commandRegistry from "@/registry/command-registry.json"

interface CommandEntry {
  owner: string
  layer: string
  input?: Record<string, string>
  output?: string
  description?: string
  description_th?: string
  requires_confirmation?: boolean
  status?: string
}

function toJsonSchema(input: Record<string, string> = {}): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [rawKey, typeStr] of Object.entries(input)) {
    const optional = rawKey.endsWith("?")
    const key = optional ? rawKey.slice(0, -1) : rawKey
    const type = typeStr.includes("number") ? "number" : "string"
    properties[key] = { type, description: `${key}: ${typeStr}` }
    if (!optional) required.push(key)
  }

  return { type: "object", properties, required }
}

export async function GET() {
  const tools = Object.entries(commandRegistry.commands)
    .filter(([key, def]) => {
      if (key.startsWith("_")) return false
      const d = def as CommandEntry
      if (d.status === "deprecated") return false
      if (d.requires_confirmation) return false // write commands ไม่เปิดให้ external AI ตรงๆ
      return true
    })
    .map(([name, def]) => {
      const d = def as CommandEntry
      return {
        type: "function",
        function: {
          name: name.replace(/\./g, "__"), // dot → double-underscore สำหรับ OpenAI
          description: [
            d.description_th ?? d.description ?? "",
            `layer: ${d.layer}`,
            `output: ${d.output ?? "unknown"}`,
          ].filter(Boolean).join(" | "),
          parameters: toJsonSchema(d.input ?? {}),
          // DNA OS native name (ใช้กับ /api/v1/query)
          _dna_command: name,
        },
      }
    })

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
