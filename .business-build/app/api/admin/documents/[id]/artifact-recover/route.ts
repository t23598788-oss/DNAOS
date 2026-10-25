import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { createDocumentArtifacts } from "@/engines/documents/artifact"
import { storeDocumentArtifacts } from "@/gateway/document-artifact-storage"
import { persistGeneratedArtifact, sha256Of } from "@/engines/canonical/artifact-write"
import { recordCanonicalAudit } from "@/engines/canonical/audit"
import { DOC_LABELS } from "@/engines/documents/engine"
import { findDocumentTable, loadDocFromRecord, buildDocDataFromRecord } from "@/app/api/admin/documents/_lib/docDataFromRecord"
import { findStoredFiles } from "../recover-helpers"

type Params = { params: Promise<{ id: string }> }

// CANONICAL DOCUMENT ARTIFACT RECOVERY (owner mission 2026-10-10, PHASE 5).
// กู้ไฟล์ PNG/PDF ของเอกสารที่มี canonical record อยู่แล้วแต่ไม่มีไฟล์ใน
// storage — ใช้ renderer เดิม (engines/documents/artifact) · storage เดิม
// (attachments/generated-documents) · metadata writer เดิม
// (engines/canonical/artifact-write) ทั้งเส้น ไม่มี pipeline ใหม่ ไม่แตะ
// ยอดเงิน ไม่สร้างเอกสาร ไม่ส่ง LINE (ไม่ import registry/communication).
// ไฟล์ที่กู้ได้ถูกทำเครื่องหมาย produced_by = "recovery:canonical-record"
// เพื่อแยกจากไฟล์ต้นฉบับที่เคยส่งจริง (PHASE 7 ORIGINAL vs RECONSTRUCTED).

const OPERATION = "artifact-recovery-2026-10-10"
const RECOVERED_BY = "recovery:canonical-record"

interface FileCheck {
  path: string
  bytes: Buffer
  sha256: string
  size: number
  opened: boolean
}

async function downloadAndCheck(path: string): Promise<FileCheck | null> {
  const { data, error } = await supabase().storage.from("attachments").download(path)
  if (error || !data) return null
  const bytes = Buffer.from(await data.arrayBuffer())
  return { path, bytes, sha256: sha256Of(bytes), size: bytes.byteLength, opened: bytes.byteLength > 0 }
}

/** generated-documents/{docId}/{ts}/… — convention ของ storeDocumentArtifacts */
// Single stored-file lookup shared with file/route.ts (owner mission 2026-10-10) —
// local copy removed, behavior unchanged.
const VERSION_COLUMN = (table: string) => (table === "invoices" ? "invoice_id" : "standalone_document_id")

async function versionRows(table: string, id: string) {
  const { data } = await supabase()
    .from("document_versions")
    .select("id, version_no, status")
    .eq(VERSION_COLUMN(table), id)
    .order("version_no", { ascending: false })
  return data ?? []
}

async function artifactRowsForVersions(versionIds: string[]) {
  if (!versionIds.length) return []
  const { data } = await supabase()
    .from("document_artifacts")
    .select("id, document_version_id, kind, storage_path, sha256, size_bytes, mime_type, produced_by, created_at")
    .in("document_version_id", versionIds)
  return data ?? []
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function pdfPages(bytes: Buffer): number {
  const matches = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g)
  return matches ? matches.length : 1
}


export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const actor = auth.email ?? auth.id

  const { id } = await params
  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dry_run") === "1" // ตรวจอย่างเดียว ไม่เขียนอะไรเลย

  const table = await findDocumentTable(id)
  if (!table) return NextResponse.json({ error: "ไม่พบเอกสาร", code: "DOCUMENT_NOT_FOUND" }, { status: 404 })
  const doc = await loadDocFromRecord(table, id)
  if (!doc) return NextResponse.json({ error: "ไม่พบเอกสาร", code: "DOCUMENT_NOT_FOUND" }, { status: 404 })
  if (!doc.docNumber) {
    return NextResponse.json({ error: "เอกสารไม่มีเลขที่ — หยุดเฉพาะเอกสารนี้ (DATA_INCOMPLETE)", code: "DATA_INCOMPLETE" }, { status: 409 })
  }

  const versions = await versionRows(table, id)
  const latest = versions[0] ?? null
  let artifactRows = await artifactRowsForVersions(versions.map((v) => v.id))

  // ── ตรวจ storage truth + metadata truth แบบข้ามตรวจสอบ (ห้ามเชื่อฝั่งเดียว) ──
  const existing = await findStoredFiles(id)
  const pngCheck = existing?.pngPath ? await downloadAndCheck(existing.pngPath) : null
  const pdfCheck = existing?.pdfPath ? await downloadAndCheck(existing.pdfPath) : null
  const pngValid = !!pngCheck?.opened && pngDimensions(pngCheck.bytes) !== null
  const pdfValid = !!pdfCheck?.opened && pdfCheck.bytes.subarray(0, 4).toString("latin1") === "%PDF"
  const filesValid = pngValid && pdfValid
  const metaFor = (path: string | null | undefined) =>
    path ? artifactRows.find((r) => r.storage_path === path) ?? null : null
  const pngMeta = metaFor(existing?.pngPath)
  const pdfMeta = metaFor(existing?.pdfPath)
  const metadataValid = !!pngMeta && !!pdfMeta && pngMeta.sha256 === pngCheck?.sha256 && pdfMeta.sha256 === pdfCheck?.sha256
    && Number(pngMeta.size_bytes) === pngCheck?.size && Number(pdfMeta.size_bytes) === pdfCheck?.size

  let status: "already_stored" | "metadata_attached" | "recovered" | "dry_run" = "already_stored"
  let stage = "none"

  if (!filesValid || !metadataValid) {
    if (!latest) {
      return NextResponse.json({
        error: "ARTIFACT_VERSION_REQUIRED: เอกสารนี้ไม่มี document_version — หยุดเฉพาะเอกสารนี้ ไม่สร้าง version เอง",
        code: "ARTIFACT_VERSION_REQUIRED", operation: OPERATION,
      }, { status: 409 })
    }
    if (dryRun) {
      status = "dry_run"
      stage = filesValid ? (metadataValid ? "none" : "metadata_missing") : "files_missing_or_invalid"
    } else if (filesValid && !metadataValid) {
      // ไฟล์ดีอยู่แล้วแต่ metadata หาย/ไม่ตรง — ผูก metadata เฉย ๆ (ไม่ render ใหม่)
      stage = "metadata_attach"
      const fileNameOf = (p: string) => p.split("/").pop() ?? "document.pdf"
      await persistGeneratedArtifact({
        document_version_id: latest.id, kind: "image", fileName: fileNameOf(pngCheck!.path),
        bytes: pngCheck!.bytes, mime_type: "image/png", produced_by: `${RECOVERED_BY}:metadata-attach`,
        actor, storage_path: pngCheck!.path, already_uploaded: true,
      })
      await persistGeneratedArtifact({
        document_version_id: latest.id, kind: "pdf", fileName: fileNameOf(pdfCheck!.path),
        bytes: pdfCheck!.bytes, mime_type: "application/pdf", produced_by: `${RECOVERED_BY}:metadata-attach`,
        actor, storage_path: pdfCheck!.path, already_uploaded: true,
      })
      artifactRows = await artifactRowsForVersions(versions.map((v) => v.id))
      status = "metadata_attached"
    } else {
      // render จาก canonical record แล้วเก็บผ่าน pipeline เดิมทั้งเส้น
      stage = "render_and_store"
      const docData = await buildDocDataFromRecord(doc)
      try {
        await storeDocumentArtifacts(id, docData, {
          document_version_id: latest.id, actor, produced_by: RECOVERED_BY,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const failureStage = msg.startsWith("บันทึกภาพเอกสาร") || msg.startsWith("บันทึก PDF") ? "UPLOAD_FAILED"
          : msg.startsWith("สร้างลิงก์") ? "READ_FAILED" : "RENDER_FAILED"
        try {
          await recordCanonicalAudit({
            action: "artifact.failed", entity_type: "document_version", entity_id: latest.id, actor,
            new_value: { stage: failureStage, operation: OPERATION, document_no: doc.docNumber, error: msg },
          })
        } catch { /* audit ห้ามทำให้ request พัง */ }
        return NextResponse.json({ error: msg, code: failureStage, operation: OPERATION, document_no: doc.docNumber }, { status: 500 })
      }
      status = "recovered"
      artifactRows = await artifactRowsForVersions([...versions.map((v) => v.id), latest.id])
    }
  }

  const finalFiles = await findStoredFiles(id)
  const finalPng = finalFiles?.pngPath ? await downloadAndCheck(finalFiles.pngPath) : null
  const finalPdf = finalFiles?.pdfPath ? await downloadAndCheck(finalFiles.pdfPath) : null
  return buildResponse({ status, stage, doc, table, latest, artifactRows, png: finalPng, pdf: finalPdf, actor })
}

type ArtifactRow = { id: string; document_version_id: string; kind: string; storage_path: string; sha256: string; size_bytes: number; mime_type: string; produced_by: string; created_at: string }

function buildResponse(args: {
  status: "already_stored" | "metadata_attached" | "recovered" | "dry_run"
  stage: string
  doc: NonNullable<Awaited<ReturnType<typeof loadDocFromRecord>>>
  table: string
  latest: { id: string; version_no: number; status: string } | null
  artifactRows: ArtifactRow[]
  png: FileCheck | null
  pdf: FileCheck | null
  actor: string
}) {
  const { status, stage, doc, table, latest, artifactRows, png, pdf } = args
  const metaFor = (path: string | null | undefined) =>
    path ? artifactRows.find((r) => r.storage_path === path) ?? null : null
  const evidence = (kind: "image" | "pdf", check: FileCheck | null) => {
    const meta = metaFor(check?.path ?? null)
    return {
      kind,
      storage_path: check?.path ?? null,
      artifact_id: meta?.id ?? null,
      sha256: check?.sha256 ?? null,
      size_bytes: check?.size ?? null,
      mime_type: kind === "image" ? "image/png" : "application/pdf",
      produced_by: meta?.produced_by ?? null,
      metadata_created_at: meta?.created_at ?? null,
      opened: check?.opened ?? false,
      sha256_verified: !!meta && !!check && meta.sha256 === check.sha256 && Number(meta.size_bytes) === check.size,
      decoded: kind === "image" ? (check ? pngDimensions(check.bytes) : null) : check ? { pages: pdfPages(check.bytes) } : null,
    }
  }
  const artifacts = [evidence("image", png), evidence("pdf", pdf)]
  const reconstructed = artifacts.some((a) => a.produced_by?.startsWith(RECOVERED_BY))
  return NextResponse.json({
    ok: true,
    operation: OPERATION,
    status,
    stage,
    note: status === "already_stored"
      ? "ไฟล์มีอยู่แล้วใน storage — read-back + sha256 ตรวจผ่าน ไม่มีการสร้างซ้ำ"
      : status === "metadata_attached"
        ? "ไฟล์เดิมดีอยู่แล้ว — ผูก metadata (document_artifacts) ให้ตรงโดยไม่ render ใหม่"
        : status === "recovered"
          ? "RECONSTRUCTED ARTIFACT — สร้างจาก canonical record ด้วย renderer เดิม (ไม่ใช่ไฟล์ที่เคยส่งในอดีต)"
          : "DRY RUN — ตรวจอย่างเดียว ไม่มีการเขียนใด ๆ",
    origin: reconstructed ? "RECONSTRUCTED" : status === "already_stored" ? "STORED_ARTIFACT" : "NONE",
    document: {
      id: doc.id, table, document_no: doc.docNumber, type: doc.docType, raw_type: doc.rawType,
      label: DOC_LABELS[doc.docType], date: doc.date, record_status: doc.status,
      subtotal: doc.subtotal, vat: doc.vat, total: doc.total, items_count: doc.items.length,
    },
    version: latest ? { id: latest.id, version_no: latest.version_no, status: latest.status } : null,
    artifacts,
    actor: args.actor,
  })
}

