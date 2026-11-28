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
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"

const BUCKET = "attachments"
const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const formData = await req.formData()
  const file = formData.get("file")
  const documentId = formData.get("documentId")

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: `ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_SIZE_BYTES / 1024 / 1024}MB)` }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: `ไม่รองรับไฟล์ประเภท ${file.type}` }, { status: 400 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const folder = typeof documentId === "string" && documentId ? documentId : "unfiled"
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

  const path = req.nextUrl.searchParams.get("path")
  const documentId = req.nextUrl.searchParams.get("documentId")

  if (path) {
    const { data, error } = await supabaseAdmin().storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 5) // 5 minutes
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ url: data.signedUrl })
  }

  if (documentId) {
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

  const path = req.nextUrl.searchParams.get("path")
  if (!path) return NextResponse.json({ error: "ต้องระบุ path" }, { status: 400 })

  const { error } = await supabaseAdmin().storage.from(BUCKET).remove([path])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
