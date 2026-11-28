import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { DOC_LABELS } from "@/engines/documents/engine"
import { createDocumentArtifacts } from "@/engines/documents/artifact"
import { lineDocumentMessages } from "@/gateway/document-artifact-storage"
import { loadDocFromRecord, buildDocDataFromRecord, type LoadedDoc } from "@/app/api/admin/documents/_lib/docDataFromRecord"

type Params = { params: Promise<{ lineUserId: string }> }

// DOCUMENT IMAGE & PREVIEW (owner mission 2026-10-10) — PREVIEW ONLY.
// หน้าที่: render เอกสารจริงจาก canonical record เป็น PNG/PDF (engines/documents
// renderer เดิมทั้งหมด ไม่มี engine ใหม่) + เสิร์ฟไฟล์ต้นฉบับที่เคยสร้างไว้
// + เตรียม payload รูปแบบการส่งผ่าน LINE (lineDocumentMessages) แบบ dry-run.
// ไม่มีการส่งข้อความใด ๆ — route นี้ไม่ import registry/communication เลย
// และไม่มี insert/update/delete ใด ๆ (อ่านอย่างเดียว + render ในหน่วยความจำ).




/** ไฟล์ต้นฉบับที่เคยสร้าง/ส่งจริง — generated-documents/{id}/{ts}/… (bucket attachments). */
async function findOriginal(documentId: string) {
  const storage = supabase().storage.from("attachments")
  const prefix = `generated-documents/${documentId}`
  const { data: entries, error } = await storage.list(prefix)
  if (error || !entries?.length) return null
  const sorted = [...entries].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  for (const entry of sorted) {
    const entryPath = `${prefix}/${entry.name}`
    const isFile = /\.(png|pdf)$/i.test(entry.name)
    const { data: files } = isFile ? { data: [entry] } : await storage.list(entryPath)
    const png = (files ?? []).find((f) => /\.png$/i.test(f.name))
    const pdf = (files ?? []).find((f) => /\.pdf$/i.test(f.name))
    if (png || pdf) {
      const dir = isFile ? prefix : entryPath
      return {
        folder: isFile ? "" : entry.name,
        pngPath: png ? `${dir}/${png.name}` : null,
        pdfPath: pdf ? `${dir}/${pdf.name}` : null,
        created_at: String(entry.created_at ?? ""),
      }
    }
  }
  return null
}

function pdfPageCount(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)
  return matches ? matches.length : 1
}

function safeFileName(name: string, ext: string): string {
  const base = (name || "document").replace(/[^0-9A-Za-z._-]/g, "_")
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`
}

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const url = new URL(req.url)
  const table = url.searchParams.get("table") ?? ""
  const id = url.searchParams.get("id") ?? ""
  const format = url.searchParams.get("format") ?? "json" // json | png | pdf
  const source = url.searchParams.get("source") ?? "preview" // preview (render ใหม่จาก record) | original (ไฟล์ต้นฉบับจริง)
  const download = url.searchParams.get("download") === "1"
  if (!id || !["invoices", "standalone_documents"].includes(table)) {
    return NextResponse.json({ error: "ต้องระบุ table (invoices|standalone_documents) และ id" }, { status: 400 })
  }

  // Recipient gate — เอกสารต้องเป็นของบริษัทที่ผูกกับ contact นี้เท่านั้น (T7/T9)
  const db = supabase()
  const { data: link } = await db
    .from("company_line_links")
    .select("company_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  if (!link?.company_id) {
    return NextResponse.json({ error: "NOT_LINKED_TO_CONTACT: contact นี้ไม่มีบริษัทที่ผูกไว้", code: "NOT_LINKED_TO_CONTACT" }, { status: 404 })
  }

  const doc = await loadDocFromRecord(table, id)
  if (!doc) return NextResponse.json({ error: "ไม่พบเอกสาร", code: "DOCUMENT_NOT_FOUND" }, { status: 404 })
  if (doc.companyId !== String(link.company_id)) {
    return NextResponse.json({ error: "เอกสารนี้ไม่ได้เกี่ยวกับ contact นี้", code: "NOT_FOR_THIS_CONTACT" }, { status: 404 })
  }
  if (!doc.docNumber) {
    return NextResponse.json({ error: "เอกสารไม่มีเลขที่ — ไม่สามารถ render ได้", code: "MISSING_DOCUMENT_NO" }, { status: 409 })
  }

  const original = await findOriginal(doc.id)
  const docData = await buildDocDataFromRecord(doc)

  if (format === "json") {
    // render ในหน่วยความจำ — ไม่มีการเขียนไฟล์/ฐานข้อมูลใด ๆ
    const [fresh, origPng, origPdf] = await Promise.all([
      createDocumentArtifacts(docData),
      original?.pngPath ? supabase().storage.from("attachments").download(original.pngPath) : Promise.resolve(null),
      original?.pdfPath ? supabase().storage.from("attachments").download(original.pdfPath) : Promise.resolve(null),
    ])
    const storage = supabase().storage.from("attachments")
    const [pngSigned, pdfSigned] = await Promise.all([
      original?.pngPath ? storage.createSignedUrl(original.pngPath, 7 * 24 * 3600) : Promise.resolve({ data: null }),
      original?.pdfPath ? storage.createSignedUrl(original.pdfPath, 7 * 24 * 3600) : Promise.resolve({ data: null }),
    ])
    const label = DOC_LABELS[doc.docType]
    const { data: outRows } = await db
      .from("line_events")
      .select("id, created_at, line_message_id, status")
      .eq("direction", "out")
      .eq("extracted->>document_id", doc.id)
      .order("created_at", { ascending: false })
      .limit(1)
    const deliveryRow = outRows?.[0] ?? null
    const pngFile = origPng && typeof origPng === "object" && "data" in origPng ? origPng.data : null
    const pdfFile = origPdf && typeof origPdf === "object" && "data" in origPdf ? origPdf.data : null
    const pngBytes = pngFile ? (await pngFile.arrayBuffer()).byteLength : null
    const pdfBytes = pdfFile ? (await pdfFile.arrayBuffer()).byteLength : null

    // provenance (PHASE 7): metadata ของไฟล์จริงจาก document_artifacts — แยก
    // STORED_ARTIFACT (ไฟล์ที่เคยสร้างตอนส่ง) ออกจาก RECONSTRUCTED (กู้ย้อนหลัง)
    const versionCol = doc.table === "invoices" ? "invoice_id" : "standalone_document_id"
    const { data: vers } = await db.from("document_versions").select("id, version_no").eq(versionCol, doc.id).order("version_no", { ascending: false })
    const versIds = (vers ?? []).map((v) => v.id)
    const { data: artRows } = versIds.length
      ? await db.from("document_artifacts").select("id, document_version_id, storage_path, sha256, size_bytes, produced_by, created_at").in("document_version_id", versIds)
      : { data: [] as Array<{ id: string; document_version_id: string; storage_path: string; sha256: string; size_bytes: number; produced_by: string; created_at: string }> }
    const artForPath = (p: string | null | undefined) =>
      p ? (artRows ?? []).find((r) => r.storage_path === p) ?? null : null
    const originArt = original ? artForPath(original.pngPath) ?? artForPath(original.pdfPath) : null
    const originKind = originArt?.produced_by?.startsWith("recovery:") ? "RECONSTRUCTED" : originArt ? "STORED_ARTIFACT" : "UNVERIFIED"

    return NextResponse.json({
      mode: "PREVIEW_ONLY",
      sent: false,
      document: {
        id: doc.id, table: doc.table, document_no: doc.docNumber,
        type: doc.docType, raw_type: doc.rawType, label,
        date: doc.date, status: doc.status,
        subtotal: doc.subtotal, vat: doc.vat, total: doc.total,
        items_count: doc.items.length, notes: doc.notes,
      },
      recipient: { line_user_id: lineUserId, company_id: doc.companyId },
      delivery: deliveryRow
        ? { sent: true, line_message_id: deliveryRow.line_message_id, at: deliveryRow.created_at, status: deliveryRow.status }
        : { sent: false },
      original: original && (original.pngPath || original.pdfPath)
        ? {
            status: "ORIGINAL", origin: originKind, folder: original.folder, created_at: original.created_at,
            png_url: pngSigned.data?.signedUrl ?? null, pdf_url: pdfSigned.data?.signedUrl ?? null,
            png_bytes: pngBytes, pdf_bytes: pdfBytes,
            artifact: originArt
              ? {
                  artifact_id: originArt.id, sha256: originArt.sha256, size_bytes: originArt.size_bytes,
                  produced_by: originArt.produced_by, created_at: originArt.created_at,
                  version_no: (vers ?? []).find((v) => v.id === originArt.document_version_id)?.version_no ?? null,
                }
              : null,
          }
        : { status: "MISSING_SOURCE", origin: "NONE", reason: "ไม่พบไฟล์ต้นฉบับใน generated-documents/ของเอกสารเล่มนี้ (ระบบยังไม่เคยสร้าง/ส่งไฟล์ของเอกสารนี้)", artifact: null },
      preview: {
        source: "RENDERED_FROM_CANONICAL_RECORD",
        png_bytes: fresh.image.length, pdf_bytes: fresh.pdf.length,
        pdf_pages: pdfPageCount(fresh.pdf),
        image_scope: "PNG = หน้าแรกสำหรับดูแบบรูป · PDF = ครบทุกหน้า",
        file_name: fresh.fileName,
      },
      line_presentation: original && pngSigned.data?.signedUrl
        ? {
            send_ready: true,
            note: "รูปแบบข้อความรูปภาพที่เส้นส่งเดิมใช้ (lineDocumentMessages) — PREVIEW ONLY, ไม่มีการส่งในรอบนี้",
            url_expires_seconds: 7 * 24 * 3600,
            messages: lineDocumentMessages(
              {
                imageUrl: pngSigned.data.signedUrl,
                pdfUrl: pdfSigned.data?.signedUrl ?? pngSigned.data.signedUrl,
                imagePath: original.pngPath ?? "",
                pdfPath: original.pdfPath ?? original.pngPath ?? "",
              },
              `${label.th} ${doc.docNumber}`,
            ),
          }
        : { send_ready: false, reason: "MISSING_SOURCE — ยังไม่มีไฟล์ต้นฉบับใน storage (เส้นส่งจริงจะสร้าง artifact เองตอนส่ง)", messages: null },
    })
  }


  if (!["png", "pdf"].includes(format)) {
    return NextResponse.json({ error: "format ต้องเป็น json | png | pdf" }, { status: 400 })
  }
  const ext = format === "png" ? ".png" : ".pdf"
  const fileName = safeFileName(doc.docNumber, ext)
  const headers: Record<string, string> = {
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "private, no-store",
    "x-document-source": source === "original" && original ? "original" : "preview",
    "x-document-id": doc.id,
    "x-document-no": doc.docNumber,
  }

  if (source === "original") {
    if (!original) {
      return NextResponse.json({ error: "MISSING_SOURCE: ไม่พบไฟล์ต้นฉบับของเอกสารนี้", code: "MISSING_SOURCE" }, { status: 404 })
    }
    const path = format === "png" ? original.pngPath : original.pdfPath
    if (!path) return NextResponse.json({ error: `MISSING_SOURCE: ต้นฉบับไม่มีไฟล์ ${ext}`, code: "MISSING_SOURCE" }, { status: 404 })
    const file = await supabase().storage.from("attachments").download(path)
    if (file.error || !file.data) {
      return NextResponse.json({ error: "MISSING_SOURCE: เปิดไฟล์ต้นฉบับไม่สำเร็จ", code: "MISSING_SOURCE" }, { status: 404 })
    }
    return new NextResponse(await file.data.arrayBuffer(), {
      status: 200,
      headers: { ...headers, "Content-Type": format === "png" ? "image/png" : "application/pdf" },
    })
  }

  const fresh = await createDocumentArtifacts(docData)
  const bytes = format === "png" ? fresh.image : fresh.pdf
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { ...headers, "Content-Type": format === "png" ? "image/png" : "application/pdf" },
  })
}
