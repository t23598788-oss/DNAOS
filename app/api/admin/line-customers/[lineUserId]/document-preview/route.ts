import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { DOC_LABELS, type DocData, type DocType } from "@/engines/documents/engine"
import { createDocumentArtifacts } from "@/engines/documents/artifact"
import { loadCompanySettings } from "@/core/config/company-settings"
import { lineDocumentMessages } from "@/gateway/document-artifact-storage"

type Params = { params: Promise<{ lineUserId: string }> }

// DOCUMENT IMAGE & PREVIEW (owner mission 2026-10-10) — PREVIEW ONLY.
// หน้าที่: render เอกสารจริงจาก canonical record เป็น PNG/PDF (engines/documents
// renderer เดิมทั้งหมด ไม่มี engine ใหม่) + เสิร์ฟไฟล์ต้นฉบับที่เคยสร้างไว้
// + เตรียม payload รูปแบบการส่งผ่าน LINE (lineDocumentMessages) แบบ dry-run.
// ไม่มีการส่งข้อความใด ๆ — route นี้ไม่ import registry/communication เลย
// และไม่มี insert/update/delete ใด ๆ (อ่านอย่างเดียว + render ในหน่วยความจำ).

// doc type mapping ของจอนี้ = ชุดเดียวกับ send-document route (ของเดิม)
const ENUM_TO_DOC_TYPE: Record<string, DocType> = {
  QT: "quotation",
  RCP: "receipt",
  ORD: "delivery_order",
  BOQ: "boq",
  PO: "purchase_order",
  PV: "payment_voucher",
}

interface LoadedDoc {
  table: "invoices" | "standalone_documents"
  id: string
  docNumber: string
  docType: DocType
  rawType: string
  date: string
  status: string
  companyId: string
  subtotal: number
  vat: number
  total: number
  notes: string | null
  items: { description: string; qty: number; unit: string; unitPrice: number }[]
}

async function loadDoc(table: string, id: string): Promise<LoadedDoc | null> {
  const db = supabase()
  if (table === "invoices") {
    const { data: inv } = await db
      .from("invoices")
      .select("id, invoice_no, invoice_status, customer_company_id, subtotal, vat_amount, total_amount, invoice_date, notes")
      .eq("id", id)
      .maybeSingle()
    if (!inv) return null
    const { data: rows } = await db
      .from("invoice_items")
      .select("description, qty, unit, unit_price")
      .eq("invoice_id", id)
      .order("sort_order", { ascending: true })
    return {
      table: "invoices",
      id,
      docNumber: String(inv.invoice_no ?? ""),
      docType: "invoice",
      rawType: "invoice",
      date: String(inv.invoice_date ?? "").slice(0, 10),
      status: String(inv.invoice_status ?? ""),
      companyId: String(inv.customer_company_id ?? ""),
      subtotal: Number(inv.subtotal ?? 0),
      vat: Number(inv.vat_amount ?? 0),
      total: Number(inv.total_amount ?? 0),
      notes: inv.notes ?? null,
      items: (rows ?? []).map((r) => ({
        description: String(r.description ?? ""),
        qty: Number(r.qty ?? 0),
        unit: String(r.unit ?? "รายการ"),
        unitPrice: Number(r.unit_price ?? 0),
      })),
    }
  }
  if (table === "standalone_documents") {
    const { data: doc } = await db
      .from("standalone_documents")
      .select("id, document_no, document_type, status, customer_company_id, subtotal, vat_amount, total_amount, document_date, notes")
      .eq("id", id)
      .maybeSingle()
    if (!doc) return null
    const { data: rows } = await db
      .from("standalone_document_items")
      .select("description, qty, unit, unit_price")
      .eq("document_id", id)
      .order("sort_order", { ascending: true })
    const rawType = String(doc.document_type ?? "")
    // DB reality (census 2026-10-10): document_type เก็บเป็น full word
    // (receipt/quotation/delivery_order) — รองรับทั้ง full word และรหัสเก่า
    // (QT/RCP/ORD/…) แบบ send-document route
    const resolvedType: DocType | undefined =
      rawType in DOC_LABELS ? (rawType as DocType) : ENUM_TO_DOC_TYPE[rawType]
    return {
      table: "standalone_documents",
      id,
      docNumber: String(doc.document_no ?? ""),
      docType: resolvedType ?? "quotation",
      rawType,
      date: String(doc.document_date ?? "").slice(0, 10),
      status: String(doc.status ?? ""),
      companyId: String(doc.customer_company_id ?? ""),
      subtotal: Number(doc.subtotal ?? 0),
      vat: Number(doc.vat_amount ?? 0),
      total: Number(doc.total_amount ?? 0),
      notes: doc.notes ?? null,
      items: (rows ?? []).map((r) => ({
        description: String(r.description ?? ""),
        qty: Number(r.qty ?? 0),
        unit: String(r.unit ?? "รายการ"),
        unitPrice: Number(r.unit_price ?? 0),
      })),
    }
  }
  return null
}

/** Canonical DocData — จาก record ใน DB เท่านั้น (ยอด/เลข/รายการเดิม ไม่คำนวณใหม่). */
async function buildDocData(doc: LoadedDoc): Promise<DocData> {
  const settings = await loadCompanySettings()
  const { data: party } = await supabase().from("companies").select("name").eq("id", doc.companyId).maybeSingle()
  return {
    type: doc.docType,
    company: { name: settings.companyName, taxId: settings.companyTaxId },
    docNumber: doc.docNumber,
    date: doc.date,
    status: doc.status,
    customer: { name: (party as { name?: string } | null)?.name ?? "" },
    items: doc.items.length > 0
      ? doc.items
      : [{ description: "ยอดเอกสาร", qty: 1, unit: "รายการ", unitPrice: doc.total }],
    notes: doc.notes ?? undefined,
    precomputedSummary: {
      subtotal: doc.subtotal,
      vatRate: doc.total > doc.subtotal ? doc.vat / Math.max(doc.subtotal, 1) : 0,
      vat: doc.vat,
      total: doc.total,
    },
  }
}


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

  const doc = await loadDoc(table, id)
  if (!doc) return NextResponse.json({ error: "ไม่พบเอกสาร", code: "DOCUMENT_NOT_FOUND" }, { status: 404 })
  if (doc.companyId !== String(link.company_id)) {
    return NextResponse.json({ error: "เอกสารนี้ไม่ได้เกี่ยวกับ contact นี้", code: "NOT_FOR_THIS_CONTACT" }, { status: 404 })
  }
  if (!doc.docNumber) {
    return NextResponse.json({ error: "เอกสารไม่มีเลขที่ — ไม่สามารถ render ได้", code: "MISSING_DOCUMENT_NO" }, { status: 409 })
  }

  const original = await findOriginal(doc.id)
  const docData = await buildDocData(doc)

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
            status: "ORIGINAL", folder: original.folder, created_at: original.created_at,
            png_url: pngSigned.data?.signedUrl ?? null, pdf_url: pdfSigned.data?.signedUrl ?? null,
            png_bytes: pngBytes, pdf_bytes: pdfBytes,
          }
        : { status: "MISSING_SOURCE", reason: "ไม่พบไฟล์ต้นฉบับใน generated-documents/ของเอกสารเล่มนี้ (ระบบยังไม่เคยสร้าง/ส่งไฟล์ของเอกสารนี้)" },
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
