/**
 * GET /api/v1/spec
 *
 * Public — ไม่ต้องใช้ token
 * ส่งคืน tool spec ในรูปแบบ OpenAI function-calling / Claude tool-use
 * ให้ AI ภายนอกโหลดแล้วรู้ว่า DNA OS มี tool อะไรบ้าง
 */

import { NextResponse } from "next/server"
import { getAuthedUser } from "@/core/auth/session"
import { validateApiToken } from "@/services/supabase/api-tokens"
import commandRegistry from "@/registry/command-registry.json"
import { supabaseAdmin } from "@/services/supabase/queries"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { decideCommandAccess, type CommandCaller } from "@/core/auth/apiCommandAccess"

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

export async function GET(req: Request) {
  // PUBLIC: system summary. PRIVATE: the internal tool list is returned only to a
  // logged-in session or a valid X-DNA-Token.
  // Caller identity uses the same sources as /api/v1/query: session user or
  // API token -> profile role -> resolveVerifiedScope (X-DNA-Org).
  const user = await getAuthedUser()
  const headerToken = req.headers.get("x-dna-token")
  const apiToken = !user && headerToken ? await validateApiToken(headerToken) : null
  const orgId = (req.headers.get("x-dna-org") ?? "").trim()
  let caller: CommandCaller = { role: null, organizationVerified: false }
  if (user || apiToken) {
    const db = supabaseAdmin()
    let authId: string | null = null
    let role: string | null = null
    if (user) {
      authId = user.canonicalProfileId ?? user.id
      role = user.role
    } else if (apiToken) {
      const { data } = await db.from("profiles").select("id, role").eq("email", apiToken.user_email).maybeSingle()
      if (data) {
        authId = String(data.id)
        role = String(data.role)
      }
    }
    if (authId && role) {
      const scopeResult = orgId
        ? await resolveVerifiedScope(db, { auth: { id: authId, role }, organizationId: orgId })
        : null
      caller = {
        role,
        tokenScopes: apiToken ? apiToken.scopes : undefined,
        organizationVerified: scopeResult?.ok === true,
      }
    }
  }
  const authorized = caller.role !== null
  const tools = Object.entries(commandRegistry.commands)
    .filter(([key, def]) => {
      if (key.startsWith("_")) return false
      const d = def as CommandEntry
      if (d.status === "deprecated") return false
      if (d.requires_confirmation) return false // write commands ไม่เปิดให้ external AI ตรงๆ
      // Same decision as /api/v1/query: a tool is listed only if it is callable.
      return decideCommandAccess(key, caller).allowed
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
      observer_url: null,
      tools: authorized ? tools : [],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": authorized ? "private, no-store" : "public, max-age=300",
      },
    }
  )
}
