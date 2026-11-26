/**
 * POST /api/admin/connectors/test — central connector verification by slug.
 *
 * One entry point for the settings console: the caller sends a slug (or a short
 * list) and this route runs the two levels from
 * docs/INTEGRATION_PLUGIN_CONSOLE.md §4:
 *
 *   L1 config     — _lib/verifyConnector.ts (pure shape/presence check)
 *   L2 credential — gateway/connectors.ts#runConnectorTest (the canonical Test
 *                   stage: real request, writes status/last_error/last_checked_at)
 *
 * Rules:
 *   - No new test mechanism: L2 is the same function /api/admin/connectors/[id]/test
 *     already uses, so auto-disable and audit_logs behaviour stay identical.
 *   - No secret leaves this route: only the redacted summary fields are mapped.
 *   - L1 failure stops before any write, so a broken config cannot silently
 *     overwrite a status that a real Test produced.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { listConnectors, runConnectorTest, redactConnector } from "@/gateway/connectors"
import { validateConnectorConfig } from "../_lib/verifyConnector"

export const dynamic = "force-dynamic"

const MAX_TARGETS = 20

interface VerifyResult {
  slug: string
  id: string | null
  level: "L1" | "L2"
  ok: boolean
  error?: string
  status: string | null
  enabled: boolean | null
  last_checked_at: string | null
}

function readSlugs(body: Record<string, unknown>): string[] {
  const raw = Array.isArray(body.slugs) ? body.slugs : typeof body.slug === "string" ? [body.slug] : []
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== "string") continue
    const slug = value.trim()
    if (!slug) continue
    seen.add(slug)
    if (seen.size > MAX_TARGETS) break
  }
  return [...seen]
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "ต้องส่ง JSON body { slug } หรือ { slugs: [] }" }, { status: 400 })
  }

  const slugs = readSlugs(body)
  if (slugs.length === 0) {
    return NextResponse.json({ error: "ต้องระบุ slug อย่างน้อย 1 รายการ" }, { status: 400 })
  }
  if (slugs.length > MAX_TARGETS) {
    return NextResponse.json({ error: `ทดสอบได้ครั้งละไม่เกิน ${MAX_TARGETS} รายการ` }, { status: 400 })
  }

  const connectors = await listConnectors()
  const bySlug = new Map(connectors.map((connector) => [connector.slug, connector]))

  const results: VerifyResult[] = []
  for (const slug of slugs) {
    const connector = bySlug.get(slug)
    if (!connector) {
      results.push({
        slug,
        id: null,
        level: "L1",
        ok: false,
        error: "ไม่พบ connector ตาม slug นี้",
        status: null,
        enabled: null,
        last_checked_at: null,
      })
      continue
    }

    const configCheck = validateConnectorConfig(connector.auth_type, connector.config, connector.secret)
    if (!configCheck.ok) {
      results.push({
        slug,
        id: connector.id,
        level: "L1",
        ok: false,
        error: configCheck.error,
        status: connector.status,
        enabled: connector.enabled,
        last_checked_at: connector.last_checked_at ?? null,
      })
      continue
    }

    try {
      const tested = redactConnector(await runConnectorTest(connector.id))
      results.push({
        slug: tested.slug,
        id: tested.id,
        level: "L2",
        ok: tested.status === "connected",
        error: tested.status === "connected" ? undefined : (tested.last_error ?? "การทดสอบไม่ผ่าน"),
        status: tested.status,
        enabled: tested.enabled,
        last_checked_at: tested.last_checked_at ?? null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        slug,
        id: connector.id,
        level: "L2",
        ok: false,
        error: message,
        status: connector.status,
        enabled: connector.enabled,
        last_checked_at: connector.last_checked_at ?? null,
      })
    }
  }

  const everySlugUnknown = results.every((result) => result.id === null)
  return NextResponse.json(
    { checked_at: new Date().toISOString(), results },
    { status: everySlugUnknown ? 404 : 200 }
  )
}
