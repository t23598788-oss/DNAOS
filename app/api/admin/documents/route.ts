import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, canonicalDocumentType } from "@/services/supabase/queries"
import {
  type DocumentDraftInput,
  type DocumentType,
  calculateDocumentTotals,
  draftToDocData,
} from "@/engines/documents/document-editor"
import { DOC_LABELS, generateDoc } from "@/engines/documents/engine"
import { loadCompanySettings } from "@/core/config/company-settings"
import { getCanonicalDocumentRows } from "@/services/canonical/document-list"
import { resolveOrderForDocument } from "@/engines/canonical/transaction-write"
import { createDocument } from "@/engines/canonical/document-write"
import { buildBusinessJob, executeBusinessJob } from "@/engines/jobs/business-job-adapter"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"
import { runBusinessAcceptance } from "@/app/api/admin/ide/_lib/businessAcceptanceRuntime"
import { recordBusinessJobProgress } from "@/app/api/admin/ide/_lib/businessJobProgressRuntime"
import { handleDocumentList } from "./_lib/listDocuments"

// PHASE D3/D9 — canonical transaction linking.
// The old behaviour created a customer_order with only company+status when none
// existed (a half chain). Now the target order is resolved BEFORE the document is
// written; when the context is incomplete the request fails validation and nothing
// is written (no half chain, no orphan document).

async function resolveOrder(opts: { partnerId: string; transactionId: string | null }) {
  return resolveOrderForDocument({ customer_company_id: opts.partnerId, transactionId: opts.transactionId })
}

export async function GET(req: NextRequest) {
  // FINANCIAL DOCUMENT MANAGEMENT (owner mission 2026-10-10) — ตัวค้นหา/กรอง/ artifact
  // presence ทั้งหมดอยู่ที่ ./_lib/listDocuments (เส้นทาง canonical เดิม invoices /
  // standalone_documents + document_versions → document_artifacts) ห้ามมีที่อื่น
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds && ctx.companyIds.size === 0) {
    return NextResponse.json({ documents: [], page: 1, per_page: 0, total: 0 })
  }
  return handleDocumentList(req, ctx)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const draft: DocumentDraftInput = await req.json()

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (draft.partnerId && !isCompanyVisible(ctx, draft.partnerId)) return notFound()
  if (!draft.partnerId && ctx.scope.mode === "organization") {
    return NextResponse.json({ error: "ต้องเลือกคู่ค้าในองค์กรก่อนออกเอกสาร" }, { status: 400 })
  }

  if (!draft.type || !DOC_LABELS[draft.type]) {
    return NextResponse.json({ error: "type ไม่ถูกต้อง" }, { status: 400 })
  }
  if (!draft.customer?.name?.trim()) {
    return NextResponse.json({ error: "ต้องระบุชื่อคู่ค้า" }, { status: 400 })
  }

  const label = DOC_LABELS[draft.type]
  const docNumber = draft.documentNumber?.trim() || `${label.prefix}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`

  let settings
  try {
    settings = await loadCompanySettings()
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่าข้อมูลบริษัท (ชื่อ/เลขผู้เสียภาษี/บัญชีธนาคาร) — ตั้งค่าที่เมนู ตั้งค่า ก่อนออกเอกสาร", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    )
  }
  const documentData = draftToDocData(draft, docNumber, settings)
  const rendered = generateDoc(documentData)
  const totals = calculateDocumentTotals(draft)

  // PHASE D3/D9 — resolve the transaction BEFORE writing anything.
  // Incomplete context ⇒ validation error, no document, no half chain.
  let orderId: string | null = null
  if (draft.partnerId) {
    const resolution = await resolveOrder({ partnerId: draft.partnerId, transactionId: draft.transactionId || null })
    if (!resolution.linked || !resolution.order_id) {
      return NextResponse.json(
        { error: resolution.reason ?? "บริบทงานไม่ครบ", code: resolution.code ?? "TRANSACTION_CONTEXT_INCOMPLETE" },
        { status: 400 },
      )
    }
    orderId = resolution.order_id
  }

  // PHASE D2/D9 — every document goes through the canonical write service:
  // v1.1 money ladder, real line items, version 1 snapshot, audit.
  //
  // IntegrPASS 3 (G1+G3) — the SAME writer now runs inside the canonical job envelope.
  // Control metadata is added separately; the business payload/paths below are untouched.
  const writeInput = {
    kind: draft.type === "invoice" ? ("invoice" as const) : ("standalone_document" as const),
    document_no: docNumber,
    document_type: draft.type,
    customer_company_id: draft.partnerId || null,
    customer_order_id: orderId,
    issue_date: draft.issueDate || null,
    due_date: draft.type === "invoice" ? draft.dueDate || null : null,
    reference_no: draft.reference || null,
    notes: draft.note || null,
    rows: draft.rows,
    discountAmount: draft.discountAmount ?? 0,
    vatEnabled: draft.vatEnabled,
    vatMode: draft.vatMode,
    withholdingTaxPercent: draft.withholdingTaxPercent,
    items: draft.rows.map((r, i) => ({
      description: r.description,
      qty: r.qty,
      unit: r.unit ?? null,
      unit_price: r.unitPrice,
      sort_order: i,
    })),
    actor: auth.email,
    status: draft.type === "invoice" ? ("DRAFT" as const) : ("active" as const),
  }

  const builtJob = buildBusinessJob({
    capability: "document.create",
    requested_by: { kind: "staff", id: auth.email ?? "admin" },
    idempotency_key: `document.create:${docNumber}`,
    exec_args: writeInput,
  })

  let execution: Awaited<ReturnType<typeof executeBusinessJob<Awaited<ReturnType<typeof createDocument>>>>>
  try {
    execution = await executeBusinessJob(
      builtJob.envelope!,
      async (envelope) => ({
        // The canonical writer remains the executor — unchanged.
        result: await createDocument(envelope.exec_args as Parameters<typeof createDocument>[0]),
        observed_writes: writeInput.kind === "invoice"
          ? ["invoices", "invoice_items", "document_versions", "audit_logs"]
          : ["standalone_documents", "standalone_document_items", "document_versions", "audit_logs"],
      }),
      { acceptanceRunner: runBusinessAcceptance },
    )
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "สร้างเอกสารไม่สำเร็จ" }, { status: 500 })
  }

  // Control-plane failure (blocked/pending/failed) — the business payload is not sent.
  if (!execution.result) {
    return NextResponse.json(
      { error: execution.violations[0] ?? "งานถูกปฏิเสธโดย canonical job envelope", control: { status: execution.status, job_id: execution.job_id, violations: execution.violations } },
      { status: 500 },
    )
  }

  const created = execution.result

  const doc = {
    id: created.document_id,
    document_number: created.document_no,
    document_type: draft.type,
    status: draft.type === "invoice" ? "draft" : "active",
    created_at: new Date().toISOString(),
    totals: created.totals,
    version_no: created.version.version_no,
    items_written: created.items_written,
    transaction_id: orderId,
  }

  void rendered
  void totals

  // Business response unchanged; control metadata is additive and separate.
  // IntegrPASS 4 (G8) — the same job also appends real progress to the EXISTING checkpoint chain
  // (control plane only; business truth stays in the canonical writer's rows).
  const progress = await recordBusinessJobProgress({
    job_id: execution.job_id ?? "unknown",
    capability: execution.capability,
    status: execution.status,
    executor: execution.control?.executor ?? { module: "engines/canonical/document-write.ts", export: "createDocument" },
    acceptance: execution.acceptance ?? [],
    document_id: created.document_id,
    actor: auth.email ?? "admin",
  })

  return NextResponse.json(
    {
      document: doc,
      control: {
        status: execution.status,
        job_id: execution.job_id,
        capability: execution.capability,
        executor: execution.control?.executor ?? null,
        envelope_digest: execution.control?.envelope_digest ?? null,
        acceptance: execution.acceptance ?? [],
        progress: { step: progress.step, checkpoint_id: progress.checkpoint_id, recorded: progress.recorded, business_truth: progress.business_truth },
      },
    },
    { status: 201 },
  )
}
