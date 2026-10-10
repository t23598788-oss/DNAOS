import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { findDocumentTable, loadDocFromRecord, buildDocDataFromRecord } from "../../_lib/docDataFromRecord"
import { createDocumentArtifacts } from "@/engines/documents/artifact"
import { findStoredFiles } from "../recover-helpers"

// DOCUMENT FILE ACCESS (owner mission 2026-10-10) — เปิด/ดาวน์โหลดต้นฉบับ PDF/PNG
// จาก Storage ได้ทันทีจากหน้าเอกสาร โดยไม่ต้องผ่าน LINE chat: canonical record →
// (ไฟล์เดิมถ้ามี | render ใหม่ in-memory จาก builder/renderer เดียวกับ preview และ
// artifact-recover) — ไม่มี renderer ใหม่ ไม่เขียนอะไรลง DB/Storage เลย

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const kindRaw = (searchParams.get("kind") ?? "pdf").toLowerCase()
  const source = (searchParams.get("source") ?? "auto").toLowerCase() // auto | original | preview
  const download = searchParams.get("download") === "1"
  if ((kindRaw !== "pdf" && kindRaw !== "png") || !["auto", "original", "preview"].includes(source)) {
    return NextResponse.json({ error: "kind ต้องเป็น pdf|png และ source ต้องเป็น auto|original|preview" }, { status: 400 })
  }
  const kind: "pdf" | "png" = kindRaw

  const table = await findDocumentTable(id)
  if (!table) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })
  const doc = await loadDocFromRecord(table, id)
  if (!doc) return NextResponse.json({ error: "โหลดข้อมูลเอกสารไม่สำเร็จ" }, { status: 500 })

  const stored = await findStoredFiles(id)
  const originalPath = kind === "pdf" ? stored?.pdfPath ?? null : stored?.pngPath ?? null
  const useOriginal = source === "original" || (source === "auto" && originalPath)

  if (useOriginal) {
    if (!originalPath) {
      return NextResponse.json(
        { error: "เอกสารนี้ยังไม่มีไฟล์ต้นฉบับใน Storage — ใช้ source=preview หรือเรียก artifact-recover ก่อน", code: "ORIGINAL_MISSING" },
        { status: 409 },
      )
    }
    const { data, error } = await supabase().storage.from("attachments").download(originalPath)
    if (error || !data) {
      console.error("[documents/file] storage download failed:", originalPath, error?.message)
      return NextResponse.json({ error: "โหลดไฟล์จาก Storage ไม่สำเร็จ" }, { status: 502 })
    }
    const bytes = new Uint8Array(await data.arrayBuffer())
    return respond(bytes, kind, download, `original:${originalPath}`)
  }

  // preview — render in-memory ผ่าน createDocumentArtifacts (ตัวเดียวกับ
  // artifact-recover / preview) ไม่เขียน storage, ไม่แตะ metadata
  try {
    const docData = await buildDocDataFromRecord(doc)
    const artifacts = await createDocumentArtifacts(docData)
    const bytes = new Uint8Array((kind === "pdf" ? artifacts.pdf : artifacts.image))
    return respond(bytes, kind, false, "preview:rendered-in-memory")
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[documents/file] preview render failed:", msg)
    return NextResponse.json({ error: `เรนเดอร์ preview ไม่สำเร็จ: ${msg}`, code: "RENDER_FAILED" }, { status: 500 })
  }
}

function respond(bytes: Uint8Array, kind: "pdf" | "png", download: boolean, origin: string) {
  const filename = kind === "pdf" ? "document.pdf" : "preview.png"
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": kind === "pdf" ? "application/pdf" : "image/png",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=60",
      "x-document-file-origin": origin,
    },
  })
}

