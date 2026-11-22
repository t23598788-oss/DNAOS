/**
 * POST   /api/admin/upload         — upload a file to the private 'attachments' Storage bucket
 * GET    /api/admin/upload?path=…  — get a short-lived signed URL to download/view a file
 * DELETE /api/admin/upload?path=…  — remove a file
 *
 * Bucket is private (public: false) — the client never talks to Supabase Storage
 * directly. This route is the single door, authenticated the same way as every
 * other /api/admin/* write in this app (admin_session cookie).
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER, type AuthedUser } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"
import { denyUnscoped, isCompanyVisible, resolveAdminReadScope, type AdminReadScope } from "@/app/api/admin/_lib/read-scope"

const BUCKET = "attachments"
const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]

async function folderVisible(ctx: AdminReadScope, folder: string): Promise<boolean> {
  if (!folder || folder.split("/").some((part) => !part || part === "." || part === "..")) return false
  if (ctx.scope.mode === "none") return false
  // Platform scope is an explicit platform-operator scope. Organization scope
  // must be proven by an existing invoice/standalone document relationship.
  if (ctx.companyIds === null) return true
  if (folder === "unfiled") return false

  const db = supabaseAdmin()
  if (folder.startsWith("generated-documents/")) {
    const versionId = folder.split("/")[1]
    if (!versionId) return false
    const { data: version, error } = await db
      .from("document_versions")
      .select("invoice_id, standalone_document_id")
      .eq("id", versionId)
      .maybeSingle()
    let documentId = version?.invoice_id ?? version?.standalone_document_id ?? null
    if (error) return false
    // Older generated files are keyed by the business document id; newer ones
    // may be keyed by document_versions.id. Resolve only through those records.
    if (!documentId) documentId = versionId
    for (const table of ["invoices", "standalone_documents"] as const) {
      const { data: document, error: documentError } = await db
        .from(table)
        .select(table === "invoices" ? "customer_company_id" : "customer_company_id, partner_company_id")
        .eq("id", documentId)
        .maybeSingle()
      if (documentError) return false
      if (!document) continue
      const row = document as { customer_company_id?: string | null; partner_company_id?: string | null }
      if (isCompanyVisible(ctx, row.customer_company_id) || isCompanyVisible(ctx, row.partner_company_id)) return true
    }
    return false
  }

  const documentId = folder.split("/")[0]
  for (const table of ["invoices", "standalone_documents"] as const) {
    const { data, error } = await db
      .from(table)
      .select(table === "invoices" ? "customer_company_id" : "customer_company_id, partner_company_id")
      .eq("id", documentId)
      .maybeSingle()
    if (error) return false
    if (!data) continue
    const row = data as { customer_company_id?: string | null; partner_company_id?: string | null }
    return isCompanyVisible(ctx, row.customer_company_id) || isCompanyVisible(ctx, row.partner_company_id)
  }
  return false
}

function safeStoragePath(path: string): boolean {
  return Boolean(path) && !path.startsWith("/") && !path.split("/").some((part) => !part || part === "." || part === "..")
}

function folderFromPath(path: string): string {
  const parts = path.split("/")
  return parts[0] === "generated-documents" ? parts.slice(0, 2).join("/") : parts[0]
}

async function authorizedScope(auth: AuthedUser) {
  return resolveAdminReadScope(auth)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const scope = await authorizedScope(auth)
  const denied = denyUnscoped(scope)
  if (denied) return denied

  const formData = await req.formData()
  const file = formData.get("file")
  const documentId = formData.get("documentId")

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 })
  }
  const folder = typeof documentId === "string" && documentId ? documentId : "unfiled"
  if (!(await folderVisible(scope, folder))) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงเอกสารนี้" }, { status: 404 })
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: `ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_SIZE_BYTES / 1024 / 1024}MB)` }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: `ไม่รองรับไฟล์ประเภท ${file.type}` }, { status: 400 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const path = `${folder}/${Date.now()}_${safeName}`

  const bytes = await file.arrayBuffer()
  const { error } = await supabaseAdmin().storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ path, name: file.name, size: file.size, type: file.type })
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const scope = await authorizedScope(auth)
  const denied = denyUnscoped(scope)
  if (denied) return denied

  const path = req.nextUrl.searchParams.get("path")
  const documentId = req.nextUrl.searchParams.get("documentId")

  if (path) {
    if (!safeStoragePath(path)) return NextResponse.json({ error: "เส้นทางไฟล์ไม่ถูกต้อง" }, { status: 400 })
    if (!(await folderVisible(scope, folderFromPath(path)))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงไฟล์นี้" }, { status: 404 })
    }
    const { data, error } = await supabaseAdmin().storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 5) // 5 minutes
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ url: data.signedUrl })
  }

  if (documentId) {
    if (!(await folderVisible(scope, documentId))) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงเอกสารนี้" }, { status: 404 })
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).list(documentId, {
      sortBy: { column: "created_at", order: "desc" },
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const files = (data ?? [])
      .filter((f) => f.id) // skip the placeholder ".emptyFolderPlaceholder" entry Storage sometimes lists
      .map((f) => ({
        path: `${documentId}/${f.name}`,
        name: f.name.replace(/^\d+_/, ""), // strip the timestamp prefix for display
        size: f.metadata?.size ?? 0,
        type: f.metadata?.mimetype ?? "",
      }))
    return NextResponse.json({ files })
  }

  return NextResponse.json({ error: "ต้องระบุ path หรือ documentId" }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const scope = await authorizedScope(auth)
  const denied = denyUnscoped(scope)
  if (denied) return denied

  const path = req.nextUrl.searchParams.get("path")
  if (!path) return NextResponse.json({ error: "ต้องระบุ path" }, { status: 400 })
  if (!safeStoragePath(path)) return NextResponse.json({ error: "เส้นทางไฟล์ไม่ถูกต้อง" }, { status: 400 })
  const folder = folderFromPath(path)
  if (!(await folderVisible(scope, folder))) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงไฟล์นี้" }, { status: 404 })

  const { error } = await supabaseAdmin().storage.from(BUCKET).remove([path])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
