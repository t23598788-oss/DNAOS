'use client'

import { useState, useEffect, useCallback } from "react"
import {
  type DocumentType,
  type DocumentDraftInput,
  type DocumentLineItem,
  DOCUMENT_TYPE_META,
  DOCUMENT_TYPE_ORDER,
  DOCUMENT_UNIT_OPTIONS,
  createEmptyDocumentDraft,
  calculateDocumentTotals,
  formatMoney,
  mapPartnerToCustomer,
  draftToDocData,
} from "@/engines/documents/document-editor"
import { generateDoc } from "@/engines/documents/engine"
import { DOCUMENT_SERVICE_CATEGORIES } from "@/config/document-service-categories"
import { getLinkRule } from "@/engines/transactions/document-link"
import { NEXT_DOC_SUGGESTIONS } from "@/engines/documents/draft-builders"
import { getWorkflow, getNextStep, getStepIndex, TX_TYPE_LABELS } from "@/engines/transactions/workflows"
import type { TxType } from "@/engines/transactions/workflows"
import type { CompanySettings } from "@/core/config/company-settings"
import type { DebtTrackingSummary } from "@/engines/debt/tracking"
import DocumentPreview from "./DocumentPreview"
import FileUpload, { type UploadedFile } from "./FileUpload"

function printDraft(draft: DocumentDraftInput, settings: CompanySettings) {
  const docNumber = draft.documentNumber?.trim() || "ร่าง"
  const html = generateDoc(draftToDocData(draft, docNumber, settings)).html
  const w = window.open("", "_blank", "width=900,height=700")
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}

// ---------- types ----------
interface Partner {
  id: string
  name: string
  phone?: string | null
  address?: string | null
  tax_id?: string | null
  contact_name?: string | null
  partner_type_label?: string | null
}

interface DocumentListItem {
  id: string
  document_type: string
  document_number: string
  status: string
  partner_id?: string | null
  party_name?: string
  net_amount?: number
  reference_number?: string | null
  issue_date?: string
  created_at: string
  partners?: { id: string; name: string; phone?: string } | null
}

interface DebtTrackingRow {
  id: string
  partner_id: string | null
  customer_name: string
  principal_amount: number
  fee_rate: number
  interest_start_at: string
  summary: DebtTrackingSummary
}

// ---------- linked transaction (from document → transaction_id) ----------
interface LinkedTransaction {
  id: string
  tx_type: string
  state: string
  title: string | null
  events: Array<{ id: string; event_type: string; event_date: string; title: string | null; description?: string | null }>
  documents: Array<{ id: string; document_type: string; document_number: string; status: string }>
}

// ---------- props ----------
interface Props {
  mode: "browser" | "create"
  type?: DocumentType
  initialDraft?: DocumentDraftInput
  initialDocId?: string  // auto-select document ทันทีเมื่อโหลดเสร็จ (จาก ?documentId= URL param)
}

// ---------- helpers ----------
function fmtDate(d: string) {
  if (!d) return ""
  return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-amber-100 text-amber-700",
    saved: "bg-emerald-100 text-emerald-700",
    cancelled: "bg-red-100 text-red-600",
  }
  const label: Record<string, string> = { draft: "ร่าง", saved: "บันทึกแล้ว", cancelled: "ยกเลิก" }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status] ?? "bg-stone-100 text-stone-500"}`}>
      {label[status] ?? status}
    </span>
  )
}

// เอกสารเก่าบันทึก document_type แบบขีดกลาง ก่อนเปลี่ยนมาตรฐานเป็นขีดล่าง (เห็นพ้องกับ services/supabase/queries.ts)
const LEGACY_TYPE_ALIASES: Record<string, DocumentType> = {
  "purchase-order": "purchase_order",
  "delivery-order": "delivery_order",
  "payment-voucher": "payment_voucher",
}

function normalizeDocType(raw: string): DocumentType {
  return (LEGACY_TYPE_ALIASES[raw] ?? raw) as DocumentType
}

function rowFromData(item: { description?: string; detail?: string; qty?: number; unit_label?: string; unit_price?: number }): DocumentLineItem {
  return {
    description: item.description ?? "",
    detail: item.detail,
    qty: Number(item.qty ?? 0),
    unit: item.unit_label ?? "Transaction",
    unitPrice: Number(item.unit_price ?? 0),
  }
}

// ---------- main ----------
export default function DocumentBuilder({ mode, type, initialDraft, initialDocId }: Props) {
  // browser state
  const [docs, setDocs] = useState<DocumentListItem[]>([])
  const [selectedDoc, setSelectedDoc] = useState<DocumentListItem | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<DocumentDraftInput | null>(null)
  const [selectedDocTx, setSelectedDocTx] = useState<LinkedTransaction | null>(null)
  const [txActionLoading, setTxActionLoading] = useState(false)
  const [hasAutoSelected, setHasAutoSelected] = useState(false)
  const [search, setSearch] = useState("")
  const [docsLoading, setDocsLoading] = useState(false)
  const [attachments, setAttachments] = useState<UploadedFile[]>([])

  // debt_notice only — รายชื่อลูกหนี้ค้างชำระสดจากระบบติดตามหนี้ แสดงเป็นคอลัมน์รายการแทนรายการเอกสารที่บันทึกแล้ว
  const [debtRows, setDebtRows] = useState<DebtTrackingRow[]>([])
  const [debtRowsLoading, setDebtRowsLoading] = useState(false)
  const [selectedDebtRow, setSelectedDebtRow] = useState<DebtTrackingRow | null>(null)
  const [savingDebtNotice, setSavingDebtNotice] = useState(false)

  // create / edit form state
  const [draft, setDraft] = useState<DocumentDraftInput>(() => initialDraft ?? createEmptyDocumentDraft(type ?? "invoice"))
  const [partners, setPartners] = useState<Partner[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)

  // transaction context — โหลดอัตโนมัติเมื่อเลือก partner ไม่ต้องกรอกใหม่
  const [openTransactions, setOpenTransactions] = useState<{ id: string; title: string | null; state: string; tx_type: string }[]>([])
  const [selectedTxId, setSelectedTxId] = useState<string>("auto")  // "auto" = ให้ระบบจัดการ

  // load docs (browser mode)
  const loadDocs = useCallback(async () => {
    setDocsLoading(true)
    try {
      const q = type ? `?type=${type}&search=${encodeURIComponent(search)}` : `?search=${encodeURIComponent(search)}`
      const res = await fetch(`/api/admin/documents${q}`)
      const data = await res.json()
      setDocs(data.documents ?? [])
    } finally {
      setDocsLoading(false)
    }
  }, [type, search])

  // load partners
  const loadPartners = useCallback(async () => {
    const res = await fetch("/api/admin/partners")
    const data = await res.json()
    setPartners(data.partners ?? [])
  }, [])

  const loadCompanySettings = useCallback(async () => {
    const res = await fetch("/api/admin/settings")
    const data = await res.json()
    setCompanySettings(data.settings ?? null)
  }, [])

  const loadDebtRows = useCallback(async () => {
    setDebtRowsLoading(true)
    try {
      const res = await fetch("/api/admin/debt-trackings")
      const data = await res.json()
      setDebtRows(data.debtTrackings ?? [])
    } finally {
      setDebtRowsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode === "browser") {
      if (type === "debt_notice") loadDebtRows()
      else loadDocs()
    }
    loadPartners()
    loadCompanySettings()
  }, [mode, type, loadDocs, loadPartners, loadCompanySettings, loadDebtRows])

  // เลือกลูกหนี้จากรายการสด — ดึงสถานะปัจจุบันมาแสดง preview ในหน้าเดียวกัน
  async function selectDebtRow(row: DebtTrackingRow) {
    setSelectedDoc(null)
    setSelectedDebtRow(row)
    setSaveMsg(null)
    const res = await fetch(`/api/admin/debt-trackings/${row.id}/draft`)
    const data = await res.json()
    if (!data.draft) {
      setSaveMsg({ ok: false, text: data.error ?? "ดึงข้อมูลลูกหนี้ไม่สำเร็จ" })
      setSelectedDraft(null)
      return
    }
    setSelectedDraft(data.draft)
  }

  // บันทึกใบทวงหนี้ของลูกหนี้ที่กำลังดูอยู่เป็นเอกสารจริง (มีเลขที่เอกสาร)
  async function saveDebtNotice() {
    if (!selectedDraft) return
    setSavingDebtNotice(true)
    setSaveMsg(null)
    try {
      const res = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedDraft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "บันทึกไม่สำเร็จ")
      setSaveMsg({ ok: true, text: `บันทึกแล้ว: ${data.document?.document_number ?? ""}` })
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" })
    } finally {
      setSavingDebtNotice(false)
    }
  }

  // select doc from list → fetch full detail + linked transaction
  async function selectDoc(item: DocumentListItem) {
    setSelectedDebtRow(null)
    setSelectedDoc(item)
    setSelectedDocTx(null)
    setAttachments([])
    fetch(`/api/admin/upload?documentId=${item.id}`)
      .then((r) => r.json())
      .then((j) => setAttachments(j.files ?? []))
      .catch(() => {})
    const res = await fetch(`/api/admin/documents/${item.id}`)
    const result = await res.json()
    const doc = result.document
    if (!doc) return
    const docData = doc.data ?? {}
    const reconstructed: DocumentDraftInput = {
      type: normalizeDocType(doc.document_type ?? "invoice"),
      documentNumber: doc.document_number ?? "",
      issueDate: doc.issue_date ?? "",
      dueDate: doc.due_date ?? "",
      serviceCategoryKey: doc.service_category_key ?? "UNSPECIFIED",
      reference: doc.reference_number ?? "",
      terms: doc.terms ?? "",
      note: doc.note ?? "",
      discountAmount: Number(doc.discount_amount ?? 0),
      vatEnabled: doc.vat_enabled ?? true,
      vatMode: doc.vat_mode ?? "exclusive",
      withholdingTaxPercent: Number(doc.withholding_tax_percent ?? 0),
      partnerId: doc.partner_id ?? "",
      customer: {
        name: doc.party_name ?? "",
        tax: doc.party_tax_id ?? "",
        addr: doc.party_address ?? "",
        contact: doc.party_contact ?? "",
        tel: doc.party_tel ?? "",
      },
      rows: Array.isArray(docData.items) && docData.items.length > 0
        ? docData.items.map(rowFromData)
        : [{ description: "", qty: 1, unit: "Transaction", unitPrice: Number(doc.net_amount ?? 0) }],
      debt: docData.debt,
    }
    setSelectedDraft(reconstructed)

    // โหลด transaction ที่ผูกกับเอกสารนี้ (ถ้ามี)
    if (doc.transaction_id) {
      try {
        const txRes = await fetch(`/api/admin/transactions/${doc.transaction_id}`)
        if (txRes.ok) {
          const txData = await txRes.json()
          setSelectedDocTx({
            id: txData.transaction.id,
            tx_type: txData.transaction.tx_type ?? "sale",
            state: txData.transaction.state ?? "created",
            title: txData.transaction.title,
            events: txData.events ?? [],
            documents: txData.documents ?? [],
          })
        }
      } catch { /* ถ้าโหลด tx ไม่ได้ ก็แค่ไม่แสดง */ }
    }
  }

  // advance transaction state
  async function advanceTx(txId: string, action: string) {
    setTxActionLoading(true)
    setSaveMsg(null)
    try {
      const res = await fetch(`/api/admin/transactions/${txId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "เกิดข้อผิดพลาด")
      setSelectedDocTx((prev) => prev ? {
        ...prev,
        state: data.new_state,
        events: data.events ?? prev.events,
      } : prev)
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" })
    } finally {
      setTxActionLoading(false)
    }
  }

  // update form field
  function setField<K extends keyof DocumentDraftInput>(key: K, value: DocumentDraftInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function setCustomerField(key: keyof DocumentDraftInput["customer"], value: string) {
    setDraft((prev) => ({ ...prev, customer: { ...prev.customer, [key]: value } }))
  }

  function updateRow(i: number, key: keyof DocumentLineItem, value: string | number) {
    setDraft((prev) => {
      const rows = [...prev.rows]
      rows[i] = { ...rows[i], [key]: value }
      return { ...prev, rows }
    })
  }

  function addRow() {
    setDraft((prev) => ({
      ...prev,
      rows: [...prev.rows, { description: "", qty: 1, unit: "Transaction", unitPrice: 0 }],
    }))
  }

  function removeRow(i: number) {
    setDraft((prev) => ({ ...prev, rows: prev.rows.filter((_, idx) => idx !== i) }))
  }

  function pickPartner(partnerId: string) {
    const p = partners.find((x) => x.id === partnerId)
    if (!p) {
      setField("partnerId", partnerId)
      return
    }
    setDraft((prev) => ({
      ...prev,
      partnerId: p.id,
      customer: mapPartnerToCustomer(p),
    }))
    setSelectedTxId("auto")
  }

  // auto-select document เมื่อโหลดรายการเสร็จ (จาก ?documentId= URL param)
  useEffect(() => {
    if (!hasAutoSelected && initialDocId && docs.length > 0) {
      const target = docs.find((d) => d.id === initialDocId)
      if (target) {
        setHasAutoSelected(true)
        selectDoc(target)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, initialDocId, hasAutoSelected])

  // โหลด open transactions ของ partner + doc type นี้ เมื่อเลือก partner หรือเปลี่ยน doc type
  useEffect(() => {
    if (!draft.partnerId || mode !== "create") { setOpenTransactions([]); return }
    const rule = getLinkRule(draft.type)
    if (!rule) { setOpenTransactions([]); return }
    fetch(`/api/admin/transactions?partner_id=${draft.partnerId}&tx_type=${rule.tx_type}&pending=1`)
      .then((r) => r.json())
      .then((d) => setOpenTransactions(d.transactions ?? []))
      .catch(() => setOpenTransactions([]))
  }, [draft.partnerId, draft.type, mode])

  // save new document
  async function saveDocument() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const payload = {
        ...draft,
        transactionId: selectedTxId !== "auto" ? selectedTxId : undefined,
      }
      const res = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "บันทึกไม่สำเร็จ")
      setSaveMsg({ ok: true, text: `บันทึกแล้ว: ${data.document?.document_number ?? ""}` })
      setDraft(createEmptyDocumentDraft(type ?? draft.type))
      if (mode === "browser") loadDocs()
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" })
    } finally {
      setSaving(false)
    }
  }

  // soft delete
  async function deleteDoc(id: string) {
    if (!confirm("ลบเอกสารนี้?")) return
    await fetch(`/api/admin/documents/${id}`, { method: "DELETE" })
    setSelectedDoc(null)
    setSelectedDraft(null)
    loadDocs()
  }

  async function confirmDoc(id: string) {
    await fetch(`/api/admin/documents/${id}/confirm`, { method: "POST" })
    await loadDocs()
    if (selectedDoc?.id === id) {
      const res = await fetch(`/api/admin/documents/${id}`)
      const result = await res.json()
      setSelectedDoc((prev) => (prev ? { ...prev, status: result.document?.status ?? prev.status } : prev))
    }
  }

  const totals = calculateDocumentTotals(draft)
  const typeMeta = DOCUMENT_TYPE_META[draft.type]

  // ===================== BROWSER MODE =====================
  if (mode === "browser") {
    const meta = type ? DOCUMENT_TYPE_META[type] : null
    const isDebtNotice = type === "debt_notice"
    const filteredDebtRows = isDebtNotice
      ? debtRows
          .filter((r) => r.customer_name.toLowerCase().includes(search.toLowerCase()))
          .sort((a, b) => b.summary.daysOverdue - a.summary.daysOverdue)
      : []

    return (
      <div className="flex h-screen overflow-hidden">
        {/* Left: list */}
        <div className="w-72 shrink-0 border-r border-stone-200 bg-white flex flex-col">
          <div className="px-4 py-3 border-b border-stone-100">
            <div className="font-semibold text-stone-800 text-sm">{isDebtNotice ? "ลูกหนี้ค้างชำระ" : meta?.fullTitle ?? "เอกสารทั้งหมด"}</div>
            <div className="mt-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isDebtNotice && loadDocs()}
                placeholder={isDebtNotice ? "ค้นหาลูกค้า..." : "ค้นหาเลขที่..."}
                className="w-full text-xs border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-stone-400"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-stone-50">
            {isDebtNotice ? (
              <>
                {debtRowsLoading && <div className="text-center text-xs text-stone-400 py-8 animate-pulse">โหลด...</div>}
                {!debtRowsLoading && filteredDebtRows.length === 0 && (
                  <div className="text-center text-xs text-stone-400 py-8">ไม่มีลูกหนี้ค้างชำระ</div>
                )}
                {filteredDebtRows.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => selectDebtRow(row)}
                    className={`w-full text-left px-4 py-3 hover:bg-stone-50 transition ${selectedDebtRow?.id === row.id ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-stone-700 truncate">{row.customer_name || "—"}</span>
                      {row.summary.daysOverdue > 0 ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 shrink-0 whitespace-nowrap">เกินกำหนด {row.summary.daysOverdue} วัน</span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 shrink-0 whitespace-nowrap">ยังไม่ครบกำหนด</span>
                      )}
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[10px] text-stone-400">เริ่มคิดดอกเบี้ย {fmtDate(row.interest_start_at)}</span>
                      <span className="text-xs font-semibold text-stone-700">฿{formatMoney(row.summary.totalAmount)}</span>
                    </div>
                  </button>
                ))}
              </>
            ) : (
              <>
                {docsLoading && <div className="text-center text-xs text-stone-400 py-8 animate-pulse">โหลด...</div>}
                {!docsLoading && docs.length === 0 && (
                  <div className="text-center text-xs text-stone-400 py-8">ยังไม่มีเอกสาร</div>
                )}
                {docs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => selectDoc(doc)}
                    className={`w-full text-left px-4 py-3 hover:bg-stone-50 transition ${selectedDoc?.id === doc.id ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-semibold text-stone-700">{doc.document_number}</span>
                      <StatusBadge status={doc.status} />
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5 truncate">
                      {doc.partner_id ? (
                        <a href={`/admin/partners/${doc.partner_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-blue-600 transition">
                          {doc.partners?.name ?? doc.party_name ?? "—"}
                        </a>
                      ) : (doc.party_name ?? "—")}
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[10px] text-stone-400">{fmtDate(doc.issue_date ?? "")}</span>
                      {doc.net_amount != null && doc.net_amount > 0 && (
                        <span className="text-xs font-semibold text-stone-700">฿{formatMoney(doc.net_amount)}</span>
                      )}
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Right: preview */}
        <div className="flex-1 overflow-y-auto bg-stone-100">
          {selectedDoc && selectedDraft ? (
            <div>
              <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-stone-200 sticky top-0 z-10">
                <span className="text-sm font-semibold text-stone-700">{selectedDoc.document_number}</span>
                <StatusBadge status={selectedDoc.status} />
                {selectedDoc.partner_id && (
                  <a
                    href={`/admin/partners/${selectedDoc.partner_id}`}
                    className="text-xs text-stone-500 hover:text-blue-600 hover:underline transition truncate max-w-[160px]"
                  >
                    {selectedDoc.partners?.name ?? selectedDoc.party_name ?? ""}
                  </a>
                )}
                <div className="flex-1" />
                {(NEXT_DOC_SUGGESTIONS[selectedDoc.document_type] ?? []).map((s) => (
                  <a
                    key={s.type}
                    href={`/admin/create-document?fromDocId=${selectedDoc.id}&type=${s.type}`}
                    className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition whitespace-nowrap"
                  >
                    {s.label} →
                  </a>
                ))}
                {selectedDoc.status === "draft" && (
                  <button onClick={() => confirmDoc(selectedDoc.id)} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition">ยืนยันเอกสาร</button>
                )}
                <button onClick={() => companySettings && printDraft(selectedDraft, companySettings)} disabled={!companySettings} className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-600 transition disabled:opacity-40">พิมพ์</button>
                <button onClick={() => deleteDoc(selectedDoc.id)} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition">ลบ</button>
              </div>
              {/* Attachments — ไฟล์อ้างอิงที่แนบกับเอกสารนี้ */}
              <div className="bg-white border-b border-stone-200 px-6 py-3">
                <FileUpload documentId={selectedDoc.id} files={attachments} onChange={setAttachments} />
              </div>
              {/* Transaction status bar — แสดงเมื่อเอกสารผูกกับ transaction */}
              {selectedDocTx && (() => {
                const wf = getWorkflow(selectedDocTx.tx_type)
                const currentIdx = getStepIndex(wf, selectedDocTx.state)
                const nextStep = getNextStep(wf, selectedDocTx.state)
                return (
                  <div className="bg-indigo-50/70 border-b border-indigo-100 px-6 py-3 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/admin/jobs/${selectedDocTx.id}`}
                        className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase tracking-wider shrink-0 hover:bg-indigo-200 transition"
                      >
                        {TX_TYPE_LABELS[selectedDocTx.tx_type as TxType] ?? selectedDocTx.tx_type}
                      </a>
                      {selectedDocTx.title && (
                        <a href={`/admin/jobs/${selectedDocTx.id}`} className="text-xs text-stone-500 truncate flex-1 hover:underline hover:text-indigo-600 transition">
                          {selectedDocTx.title}
                        </a>
                      )}
                      {!selectedDocTx.title && (
                        <a href={`/admin/jobs/${selectedDocTx.id}`} className="text-xs text-stone-400 hover:text-indigo-600 hover:underline transition flex-1">
                          ดูงาน →
                        </a>
                      )}
                      {saveMsg && !saveMsg.ok && (
                        <span className="text-xs text-red-600 shrink-0">{saveMsg.text}</span>
                      )}
                      {nextStep && (
                        <button
                          onClick={() => advanceTx(selectedDocTx.id, nextStep.action)}
                          disabled={txActionLoading}
                          className="text-xs px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          ✓ {nextStep.action_label}
                        </button>
                      )}
                      {!nextStep && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 shrink-0">ปิดงานแล้ว</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {wf.steps.map((step, i) => (
                        <span
                          key={step.event}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap transition ${
                            i === currentIdx
                              ? "bg-indigo-600 text-white"
                              : i < currentIdx
                              ? "bg-indigo-100 text-indigo-500"
                              : "bg-stone-100 text-stone-400"
                          }`}
                        >
                          {i < currentIdx ? "✓ " : ""}{step.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })()}
              <div className="p-6">
                <DocumentPreview draft={selectedDraft} settings={companySettings} />
              </div>
            </div>
          ) : selectedDebtRow && selectedDraft ? (
            <div>
              <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-stone-200 sticky top-0 z-10">
                <span className="text-sm font-semibold text-stone-700">{selectedDebtRow.customer_name}</span>
                {selectedDebtRow.summary.daysOverdue > 0 ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">เกินกำหนด {selectedDebtRow.summary.daysOverdue} วัน</span>
                ) : (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">ยังไม่ครบกำหนด</span>
                )}
                <div className="flex-1" />
                {saveMsg && (
                  <span className={`text-xs ${saveMsg.ok ? "text-emerald-600" : "text-red-600"}`}>{saveMsg.text}</span>
                )}
                <button onClick={saveDebtNotice} disabled={savingDebtNotice} className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-600 transition disabled:opacity-40">
                  {savingDebtNotice ? "กำลังบันทึก..." : "บันทึกเอกสาร"}
                </button>
                <button onClick={() => companySettings && printDraft(selectedDraft, companySettings)} disabled={!companySettings} className="text-xs px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 transition disabled:opacity-40">พิมพ์ / ส่งออก PDF</button>
              </div>
              <div className="p-6">
                <DocumentPreview draft={selectedDraft} settings={companySettings} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-stone-400 text-sm">
              {isDebtNotice ? "เลือกลูกหนี้จากรายการด้านซ้าย" : "เลือกเอกสารจากรายการด้านซ้าย"}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ===================== CREATE MODE =====================
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left: form */}
      <div className="w-[480px] shrink-0 border-r border-stone-200 bg-white overflow-y-auto">
        <div className="px-5 py-4 border-b border-stone-100 sticky top-0 bg-white z-10">
          <div className="font-semibold text-stone-800">สร้างเอกสาร</div>
          {saveMsg && (
            <div className={`mt-2 text-xs px-3 py-1.5 rounded-lg ${saveMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
              {saveMsg.text}
            </div>
          )}
        </div>

        <div className="px-5 py-4 space-y-5">

          {/* Type selector */}
          <section>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">ประเภทเอกสาร</label>
            {draft.type === "debt_notice" ? (
              <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                ใบติดตามหนี้ — เชื่อมข้อมูลจากระบบติดตามหนี้โดยตรง
              </div>
            ) : (
              <div className="flex gap-1 flex-wrap">
                {DOCUMENT_TYPE_ORDER.map((t) => (
                  <button
                    key={t}
                    onClick={() => setField("type", t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${draft.type === t ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}
                  >
                    {DOCUMENT_TYPE_META[t].prefix}
                  </button>
                ))}
              </div>
            )}
            <div className="text-xs text-stone-400 mt-1">{typeMeta.fullTitle}</div>
          </section>

          {/* Debt summary (read-only, linked from debt_trackings) */}
          {draft.debt && (
            <section className="border border-amber-200 rounded-xl p-3 bg-amber-50 space-y-1 text-xs text-amber-900">
              <div className="font-semibold text-[10px] uppercase tracking-wider text-amber-600 mb-1">ยอดหนี้ (จากระบบติดตามหนี้)</div>
              <div className="flex justify-between"><span>เงินต้น</span><span className="tabular-nums">{formatMoney(draft.debt.principal)}</span></div>
              <div className="flex justify-between"><span>ค่าธรรมเนียม</span><span className="tabular-nums">{formatMoney(draft.debt.fee)}</span></div>
              <div className="flex justify-between"><span>จำนวนวัน</span><span className="tabular-nums">{draft.debt.daysOverdue} วัน</span></div>
              <div className="flex justify-between"><span>ดอกเบี้ย {(draft.debt.interestRate * 100).toFixed(0)}%/ปี</span><span className="tabular-nums">{formatMoney(draft.debt.interestAccrued)}</span></div>
            </section>
          )}

          {/* Document number */}
          <section>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">เลขที่เอกสาร</label>
            <input
              value={draft.documentNumber}
              onChange={(e) => setField("documentNumber", e.target.value)}
              placeholder={`ปล่อยว่างให้ออกเลขอัตโนมัติ (${typeMeta.prefix}-...)`}
              className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500 font-mono"
            />
          </section>

          {/* Dates */}
          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">วันออกเอกสาร</label>
              <input
                type="date"
                value={draft.issueDate}
                onChange={(e) => setField("issueDate", e.target.value)}
                className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
              />
            </div>
            {typeMeta.showDueDate && (
              <div>
                <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">วันครบกำหนด</label>
                <input
                  type="date"
                  value={draft.dueDate}
                  onChange={(e) => setField("dueDate", e.target.value)}
                  className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
                />
              </div>
            )}
          </section>

          {/* Service category */}
          <section>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">ประเภทงาน</label>
            <div className="flex flex-wrap gap-1">
              {DOCUMENT_SERVICE_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setField("serviceCategoryKey", cat.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs transition border ${draft.serviceCategoryKey === cat.id ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}
                >
                  {cat.th}
                </button>
              ))}
            </div>
          </section>

          {/* Partner picker */}
          <section>
            <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
              {typeMeta.partyLabel}
            </label>
            <select
              value={draft.partnerId}
              onChange={(e) => pickPartner(e.target.value)}
              className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500 mb-3"
            >
              <option value="">— เลือกพาร์ทเนอร์ —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.partner_type_label ? ` (${p.partner_type_label})` : ""}</option>
              ))}
            </select>
            <div className="space-y-2">
              {(["name", "tax", "contact", "tel"] as const).map((field) => (
                <input
                  key={field}
                  value={draft.customer[field]}
                  onChange={(e) => setCustomerField(field, e.target.value)}
                  placeholder={{ name: "ชื่อ / บริษัท", tax: "เลขผู้เสียภาษี", contact: "ผู้ติดต่อ", tel: "โทรศัพท์" }[field]}
                  className="w-full text-xs border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-stone-400"
                />
              ))}
              <textarea
                value={draft.customer.addr}
                onChange={(e) => setCustomerField("addr", e.target.value)}
                placeholder="ที่อยู่"
                rows={2}
                className="w-full text-xs border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-stone-400 resize-none"
              />
            </div>
          </section>

          {/* Transaction context — โหลดจากระบบอัตโนมัติเมื่อเลือก partner */}
          {draft.partnerId && getLinkRule(draft.type) && (
            <section className="border border-stone-200 rounded-xl p-3 bg-stone-50 space-y-2">
              <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
                Transaction (ระบบจัดการให้อัตโนมัติ)
              </div>
              {openTransactions.length === 0 ? (
                <div className="text-xs text-stone-400">
                  ไม่มีงานค้างสำหรับ partner นี้ — ระบบจะสร้าง Transaction ใหม่อัตโนมัติเมื่อบันทึก
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-xs text-stone-600 cursor-pointer">
                    <input
                      type="radio"
                      name="txId"
                      value="auto"
                      checked={selectedTxId === "auto"}
                      onChange={() => setSelectedTxId("auto")}
                      className="accent-stone-700"
                    />
                    สร้าง Transaction ใหม่
                  </label>
                  {openTransactions.map((tx) => (
                    <label key={tx.id} className="flex items-start gap-2 text-xs text-stone-700 cursor-pointer">
                      <input
                        type="radio"
                        name="txId"
                        value={tx.id}
                        checked={selectedTxId === tx.id}
                        onChange={() => setSelectedTxId(tx.id)}
                        className="accent-stone-700 mt-0.5"
                      />
                      <span>
                        <span className="font-semibold">{tx.title ?? "—"}</span>
                        <span className="ml-1.5 text-stone-400">({tx.state})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Line items */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">รายการ</label>
              <button onClick={addRow} className="text-xs text-blue-600 hover:underline font-semibold">+ เพิ่มรายการ</button>
            </div>
            <div className="space-y-2">
              {draft.rows.map((row, i) => (
                <div key={i} className="border border-stone-200 rounded-xl p-3 bg-stone-50 space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={row.description}
                      onChange={(e) => updateRow(i, "description", e.target.value)}
                      placeholder="รายการ / คำอธิบาย"
                      className="flex-1 text-xs border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-stone-400"
                    />
                    {draft.rows.length > 1 && (
                      <button onClick={() => removeRow(i)} className="text-[10px] text-red-400 hover:text-red-600 transition shrink-0">ลบ</button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={row.qty}
                      onChange={(e) => updateRow(i, "qty", parseFloat(e.target.value) || 0)}
                      placeholder="จำนวน"
                      className="w-20 text-xs border border-stone-200 rounded-lg px-2 py-1 focus:outline-none focus:border-stone-400 text-right"
                    />
                    <select
                      value={row.unit}
                      onChange={(e) => updateRow(i, "unit", e.target.value)}
                      className="text-xs border border-stone-200 rounded-lg px-2 py-1 focus:outline-none focus:border-stone-400"
                    >
                      {DOCUMENT_UNIT_OPTIONS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                    <input
                      type="number"
                      value={row.unitPrice}
                      onChange={(e) => updateRow(i, "unitPrice", parseFloat(e.target.value) || 0)}
                      placeholder="ราคา/หน่วย"
                      className="flex-1 text-xs border border-stone-200 rounded-lg px-2 py-1 focus:outline-none focus:border-stone-400 text-right"
                    />
                    <div className="text-xs text-stone-500 py-1 whitespace-nowrap">
                      = {formatMoney(row.qty * row.unitPrice)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* VAT & discount */}
          <section className="border border-stone-200 rounded-xl p-3 bg-stone-50 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="vat"
                checked={draft.vatEnabled}
                onChange={(e) => setField("vatEnabled", e.target.checked)}
                className="w-3.5 h-3.5"
              />
              <label htmlFor="vat" className="text-xs text-stone-700 font-medium">ภาษีมูลค่าเพิ่ม 7%</label>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[10px] text-stone-500 mb-1">ส่วนลด (บาท)</label>
                <input
                  type="number"
                  value={draft.discountAmount}
                  onChange={(e) => setField("discountAmount", parseFloat(e.target.value) || 0)}
                  className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-stone-400 text-right"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-stone-500 mb-1">หักภาษี ณ ที่จ่าย (%)</label>
                <select
                  value={draft.withholdingTaxPercent}
                  onChange={(e) => setField("withholdingTaxPercent", Number(e.target.value))}
                  className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-stone-400"
                >
                  {[0, 1, 2, 3, 5].map((v) => <option key={v} value={v}>{v}%</option>)}
                </select>
              </div>
            </div>
            {/* Summary */}
            <div className="text-xs text-stone-600 space-y-0.5 pt-1 border-t border-stone-200">
              <div className="flex justify-between"><span>ยอดรวม</span><span className="tabular-nums">{formatMoney(totals.subtotal)}</span></div>
              {totals.discountAmount > 0 && <div className="flex justify-between text-red-600"><span>ส่วนลด</span><span className="tabular-nums">− {formatMoney(totals.discountAmount)}</span></div>}
              {draft.vatEnabled && <div className="flex justify-between"><span>VAT 7%</span><span className="tabular-nums">{formatMoney(totals.vatAmount)}</span></div>}
              {totals.withholdingAmount > 0 && <div className="flex justify-between text-red-600"><span>หักภาษี ณ ที่จ่าย</span><span className="tabular-nums">− {formatMoney(totals.withholdingAmount)}</span></div>}
              <div className="flex justify-between font-bold text-stone-800 pt-1 border-t border-stone-300 text-sm"><span>ยอดสุทธิ</span><span className="tabular-nums">{formatMoney(totals.netAmount)} บาท</span></div>
            </div>
          </section>

          {/* Reference & notes */}
          <section className="space-y-3">
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">เอกสารอ้างอิง</label>
              <input
                value={draft.reference}
                onChange={(e) => setField("reference", e.target.value)}
                placeholder="เช่น INV-2026-001, DO-..."
                className="w-full text-xs border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-stone-400"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">หมายเหตุ</label>
              <textarea
                value={draft.note}
                onChange={(e) => setField("note", e.target.value)}
                rows={2}
                className="w-full text-xs border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-stone-400 resize-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">เงื่อนไข</label>
              <textarea
                value={draft.terms}
                onChange={(e) => setField("terms", e.target.value)}
                rows={2}
                className="w-full text-xs border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-stone-400 resize-none"
              />
            </div>
          </section>

          {/* Save button */}
          <div className="pb-4">
            <button
              onClick={saveDocument}
              disabled={saving}
              className="w-full py-2.5 bg-stone-800 text-white rounded-xl text-sm font-semibold hover:bg-stone-700 disabled:opacity-40 transition"
            >
              {saving ? "กำลังบันทึก..." : "บันทึกเอกสาร"}
            </button>
          </div>
        </div>
      </div>

      {/* Right: preview */}
      <div className="flex-1 overflow-y-auto bg-stone-100">
        <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-stone-200 sticky top-0 z-10">
          <span className="text-xs text-stone-500">Preview (ตัวอย่าง)</span>
          <div className="flex-1" />
          <button onClick={() => companySettings && printDraft(draft, companySettings)} disabled={!companySettings} className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-600 transition disabled:opacity-40">พิมพ์</button>
        </div>
        <div className="p-6">
          <DocumentPreview draft={draft} settings={companySettings} />
        </div>
      </div>
    </div>
  )
}
