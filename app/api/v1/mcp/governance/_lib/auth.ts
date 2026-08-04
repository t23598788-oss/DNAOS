import { NextResponse } from "next/server"
import { validateApiToken, serviceClient, type ApiToken } from "@/services/supabase/api-tokens"

export async function authenticate(req: Request, requiredScope: "read" | "governance:propose"):
  Promise<{ ok: true; token: ApiToken; db: ReturnType<typeof serviceClient> } | { ok: false; response: NextResponse }> {
  const raw = req.headers.get("x-dna-token")?.trim() ?? ""
  if (!raw) return { ok: false, response: NextResponse.json({ error: "X-DNA-Token required" }, { status: 401 }) }

  const token = await validateApiToken(raw)
  if (!token) return { ok: false, response: NextResponse.json({ error: "invalid or revoked DNA OS token" }, { status: 401 }) }

  const allowed = requiredScope === "read"
    ? token.scopes.includes("read") || token.scopes.includes("governance:read") || token.scopes.includes("governance:propose")
    : token.scopes.includes("governance:propose")
  if (!allowed) return { ok: false, response: NextResponse.json({ error: `token scope '${requiredScope}' required` }, { status: 403 }) }

  return { ok: true, token, db: serviceClient() }
}
