import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin, canonicalDocumentType } from "@/services/supabase/queries"
import { getCanonicalDocumentRows } from "@/services/canonical/document-list"

// DOCUMENT LIST + SEARCH (owner mission 2026-10-10, FINANCIAL DOCUMENT MANAGEMENT).
// ค้นได้ทั้งเลขเอกสาร/ชื่อบริษัท + วันที่ + ประเภท + สถานะ + จำนวนเงิน + เลขอ้างอิง
// และบอก presence ของ Artifact (ไฟล์ PDF/PNG ใน Storage จริงไหม) ทุกแถว —
// ทุก query อ่านจาก canonical tables เดิม ไม่มีตาราง/ engine ใหม่ และไม่เขียนอะไรเลย

const rows: any[] = []

// ค้นชื่อบริษัท → ได้ ids ไปกรองด้วย .in() (คอลัมน์ตารางหลัก) เพราะ PostgREST
// .or() ไม่รองรับ embedded resource (companies.name) — ดู Railway log:
// "failed to parse logic tree (...companies.name.ilike...)"
async function companyIdsByName(term: string): Promise<string[]> {
  if (!term) return []
  const { data } = await supabaseAdmin().from("companies").select("id").ilike("name", `%${term}%`).limit(50)
  return (data ?? []).map((c: { id: string }) => c.id)
}

async function loadInvoices(params: URLSearchParams, term: string, coIds: string[], perPage: number) {
  const canonical = params.get("type") && params.get("type") !== "all" ? canonicalDocumentType(params.get("type")!) : null
  if (canonical && canonical !== "invoice") return
  let q = supabaseAdmin()
    .from("invoices")
    .select("id, invoice_no, invoice_status, customer_company_id, customer_order_id, total_amount, reference_no, invoice_date, created_at, companies!invoices_customer_company_id_fkey(id, name, phone)")
    .order("created_at", { ascending: false })
    .range(0, perPage * 2 - 1)
  if (term) {
    const parts = [`invoice_no.ilike.%${term}%`]
    if (coIds.length) parts.push(`customer_company_id.in.(${coIds.join(",")})`)
    q = q.or(parts.join(","))
  }
  const reference = (params.get("reference") ?? "").trim()
  if (reference) q = q.ilike("reference_no", `%${reference}%`)
  const status = (params.get("status") ?? "").trim()
  if (status) q = q.ilike("invoice_status", `%${status}%`)
  const dateFrom = params.get("dateFrom")
  if (dateFrom) q = q.gte("invoice_date", dateFrom)
  const dateTo = params.get("dateTo")
  if (dateTo) q = q.lte("invoice_date", dateTo)
  const minAmount = params.get("minAmount")
  if (minAmount) q = q.gte("total_amount", Number(minAmount))
  const maxAmount = params.get("maxAmount")
  if (maxAmount) q = q.lte("total_amount", Number(maxAmount))
  const { data, error } = await q
  if (error) {
    console.error("[documents] invoices list query failed:", error.message)
    return
  }
  for (const d of (data ?? []) as any[]) {
    rows.push({
      id: d.id, document_type: "invoice", document_number: d.invoice_no ?? "",
      status: d.invoice_status?.toLowerCase() ?? "draft", partner_id: d.customer_company_id ?? null,
      party_name: d.companies?.name ?? "", net_amount: Number(d.total_amount ?? 0),
      reference_number: d.reference_no ?? null, issue_date: d.invoice_date ?? null,
      created_at: d.created_at, partners: d.companies ?? null,
    })
  }
}


async function loadStandalone(params: URLSearchParams, term: string, coIds: string[], perPage: number) {
  const typeParam = params.get("type") ?? ""
  const canonical = typeParam && typeParam !== "all" ? canonicalDocumentType(typeParam) : null
  if (canonical && canonical === "invoice") return
  let q = supabaseAdmin()
    .from("standalone_documents")
    .select("id, document_no, document_type, customer_company_id, customer_order_id, total_amount, reference_no, document_date, created_at, companies!standalone_documents_customer_company_id_fkey(id, name, phone)")
    .order("created_at", { ascending: false })
    .range(0, perPage * 2 - 1)
  if (canonical) q = q.eq("document_type", canonical)
  if (term) {
    const parts = [`document_no.ilike.%${term}%`]
    if (coIds.length) parts.push(`customer_company_id.in.(${coIds.join(",")})`)
    q = q.or(parts.join(","))
  }
  const reference = (params.get("reference") ?? "").trim()
  if (reference) q = q.ilike("reference_no", `%${reference}%`)
  const status = (params.get("status") ?? "").trim()
  if (status) q = q.ilike("status", `%${status}%`)
  const dateFrom = params.get("dateFrom")
  if (dateFrom) q = q.gte("document_date", dateFrom)
  const dateTo = params.get("dateTo")
  if (dateTo) q = q.lte("document_date", dateTo)
  const minAmount = params.get("minAmount")
  if (minAmount) q = q.gte("total_amount", Number(minAmount))
  const maxAmount = params.get("maxAmount")
  if (maxAmount) q = q.lte("total_amount", Number(maxAmount))
  const { data, error } = await q
  if (error) {
    console.error("[documents] standalone_documents list query failed:", error.message)
    return
  }
  for (const d of (data ?? []) as any[]) {
    rows.push({
      id: d.id, document_type: d.document_type ?? canonical ?? "", document_number: d.document_no ?? "",
      status: d.status ?? "draft", partner_id: d.customer_company_id ?? null,
      party_name: d.companies?.name ?? "", net_amount: Number(d.total_amount ?? 0),
      reference_number: d.reference_no ?? null, issue_date: d.document_date ?? null,
      created_at: d.created_at, partners: d.companies ?? null,
    })
  }
}

// ARTIFACT PRESENCE: แถวบอกว่ามีไฟล์ PDF/PNG เก็บใน Storage จริงไหม —
// document_versions (invoice_id/standalone_document_id) → document_artifacts
// (kind/sha256/produced_by เป็น column ตรง ไม่มี payload) — read-only
async function attachArtifacts(pageRows: any[]) {
  const artifactMap = new Map<string, { present: boolean; produced_by: string | null; pdf: boolean; png: boolean }>()
  if (pageRows.length === 0) return artifactMap
  const inList = pageRows.map((r) => r.id).join(",")
  if (!inList) return artifactMap
  const { data: versions } = await supabaseAdmin()
    .from("document_versions")
    .select("id, invoice_id, standalone_document_id")
    .or(`invoice_id.in.(${inList}),standalone_document_id.in.(${inList})`)
  const versionIds = (versions ?? []).map((v: { id: string }) => v.id)
  if (versionIds.length === 0) return artifactMap
  const { data: artifacts } = await supabaseAdmin()
    .from("document_artifacts")
    .select("id, document_version_id, kind, produced_by")
    .in("document_version_id", versionIds)
  const docIdByVersion = new Map((versions ?? []).map((v: { id: string; invoice_id: string | null; standalone_document_id: string | null }) => [v.id, (v.invoice_id ?? v.standalone_document_id) as string]))
  for (const a of (artifacts ?? []) as Array<{ document_version_id: string; kind: string; produced_by: string | null }>) {
    const docId = docIdByVersion.get(a.document_version_id)
    if (!docId) continue
    const prev = artifactMap.get(docId) ?? { present: false, produced_by: null, pdf: false, png: false }
    prev.present = true
    prev.produced_by = a.produced_by ?? prev.produced_by
    if (a.kind === "pdf") prev.pdf = true
    if (a.kind === "image") prev.png = true
    artifactMap.set(docId, prev)
  }
  return artifactMap
}

export async function handleDocumentList(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get("search") ?? "").trim()
  // PostgREST or() ต้องปราศจาก , % ( ) — ใช้เป็น term กลางทั้งสองตาราง
  const term = search.replace(/[%,()]/g, " ").trim()
  const page = Math.max(1, Number(searchParams.get("page") ?? 1))
  const perPage = Math.min(200, Number(searchParams.get("perPage") ?? 50))
  const from = (page - 1) * perPage

  rows.length = 0
  const coIds = await companyIdsByName(term)
  await Promise.all([loadInvoices(searchParams, term, coIds, perPage), loadStandalone(searchParams, term, coIds, perPage)])
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const pageRows = rows.slice(from, from + perPage)
  const artifactMap = await attachArtifacts(pageRows)
  const withArtifacts = pageRows.map((r) => ({
    ...r,
    artifact: artifactMap.get(r.id) ?? { present: false, produced_by: null, pdf: false, png: false },
  }))
  // PHASE C7 — canonical financials attached to each list row (unchanged path)
  const canon = await getCanonicalDocumentRows(withArtifacts.map((d: { id: string }) => d.id))
  return NextResponse.json({
    documents: withArtifacts.map((d: any) => ({ ...d, canonical: canon.get(d.id) ?? null })),
    page,
    per_page: perPage,
    total: rows.length,
  })
}
