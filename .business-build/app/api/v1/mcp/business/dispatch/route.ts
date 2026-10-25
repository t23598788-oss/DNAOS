/**
 * GET/POST /api/v1/mcp/business/dispatch — THE missing connection reported by
 * the OWNER WORKSPACE AI TOOL INTEGRATION inspection (2026-10-11):
 * external AI workers (Cline, AI Queen clients) could DISCOVER registry facts
 * through /api/v1/mcp/* but had NO authorized path to the canonical BUSINESS
 * dispatcher. This route is pure TRANSPORT over existing authority — it creates
 * NO reader, NO writer, NO command:
 *   requireAuth(ADMIN_TIER)  ← same session gate as every admin route (DNA OS
 *                              authenticates the Owner — worker carries the
 *                              owner session cookie, never its own authority)
 *   READ whitelist            ← explicit set; anything else 403 (fail-closed)
 *   engines/validation/      ← THE existing Capability Dispatcher (registry
 *     dispatcher                gate + input validation + Rule-72 gates inside)
 *   document.preview         ← existing getDocumentDetail reader + the SAME
 *                              version-scoped artifact rule the chat renderer
 *                              uses (renderCanonicalDetailHtml exported for
 *                              the no-stored-file case) — no new data path
 * Listed in registry/mcp-planned-manifest.json as business.dispatch (active).
 */
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { isCompanyInScope } from "@/core/auth/orgScope"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin } from "@/services/supabase/queries"
import { dispatch } from "@/engines/validation/dispatcher"
import { getDocumentDetail } from "@/services/canonical/document-detail"
import { renderCanonicalDetailHtml } from "@/app/api/chat/_lib/resultContract"

/** READ-only commands ONLY — write-capable commands are never accepted here. */
const READ_COMMANDS = new Set([
  "partner.find", "partner.list", "partner.profile", "partner.timeline",
  "document.list", "document.boq", "document.po", "document.do", "document.receipt",
  "invoice.list", "invoice.latest", "invoice.find", "invoice.items",
  "debt.list", "debt.all", "debt.current", "debt.trackings",
  "draft.list", "job.list", "job.active", "job.track",
  "material.list", "invoice.payments", "expense.list", "bank.statement", "receipt.list", "receipt.latest", "receipt.get", "weather.forecast", "fuel.prices", "transport.estimate", "material.sources",
 "purchase.history",
])

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  // STEP 3 — the AI worker bridge carries the user's session; resolve the
  // verified org scope HERE, never from the AI-generated arguments.
  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabaseAdmin(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json(
      { ok: false, code: scopeResult.code, error: scopeResult.reason },
      { status: 403 },
    )
  }
  const scope = scopeResult.scope

  const body = await req.json().catch(() => ({}))
  const command = typeof body.command === "string" ? body.command.trim() : ""
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
    ? (body.payload as Record<string, unknown>)
    : {}

  // document.preview — existing canonical reader + existing artifact rule
  if (command === "document.preview") {
    const documentId = typeof payload.document_id === "string" ? payload.document_id.trim() : ""
    const kind = payload.document_kind === "invoice" ? "invoice" : "standalone_document"
    if (!documentId) {
      return NextResponse.json({ ok: false, error: "document_id required" }, { status: 400 })
    }
    // Verify ownership BEFORE reading the detail (document_id comes from AI).
    const ownerTable = kind === "invoice" ? "invoices" : "standalone_documents"
    const { data: ownerRow } = await supabaseAdmin()
      .from(ownerTable)
      .select("customer_company_id")
      .eq("id", documentId)
      .maybeSingle()
    if (!ownerRow || !isCompanyInScope(scope, (ownerRow as { customer_company_id?: string | null }).customer_company_id)) {
      return NextResponse.json({ ok: false, error: "RESOURCE_NOT_OWNED" }, { status: 403 })
    }
    const detail = await getDocumentDetail(kind, documentId).catch(() => null)
    if (!detail) {
      return NextResponse.json({ ok: false, error: "DOCUMENT_NOT_FOUND" }, { status: 404 })
    }
    const versionId = detail.version?.id ?? null
    const versionArtifacts = versionId
      ? detail.generated_artifacts.filter((a) => String(a.document_version_id ?? "") === versionId)
      : []
    const artifact =
      versionArtifacts.length > 0
        ? [...versionArtifacts].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0]
        : null
    if (artifact?.storage_path) {
      return NextResponse.json({
        ok: true,
        command,
        data: {
          mode: "file",
          document_number: detail.identity.document_no,
          storage_path: String(artifact.storage_path),
          mime_type: String(artifact.mime_type ?? "application/octet-stream"),
          kind: String(artifact.kind ?? "file"),
          size_bytes: Number(artifact.size_bytes ?? 0),
        },
      })
    }
    return NextResponse.json({
      ok: true,
      command,
      data: {
        mode: "summary",
        document_number: detail.identity.document_no,
        summary_html: renderCanonicalDetailHtml(detail),
      },
    })
  }

  if (!READ_COMMANDS.has(command)) {
    return NextResponse.json(
      { ok: false, error: `COMMAND_NOT_PERMITTED: business.dispatch รับเฉพาะคำสั่งอ่าน whitelist (ได้ ${command || "empty"})` },
      { status: 403 },
    )
  }

  const result = await dispatch(command, payload, false, { scope }).catch((e: unknown) => ({
    ok: false,
    command,
    data: null,
    requires_confirmation: false,
    violations: [e instanceof Error ? e.message : "dispatch failed"],
  }))
  return NextResponse.json({ ok: result.ok, command, data: result.data, violations: result.violations })
}
