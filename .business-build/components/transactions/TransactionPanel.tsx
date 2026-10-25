'use client'

import { useState, useEffect, useCallback } from "react"
import {
  getWorkflow,
  getNextStep,
  getStepIndex,
  isFinalEvent,
  TX_TYPE_ORDER,
  TX_TYPE_LABELS,
  type TxType,
  type TxWorkflow,
} from "@/engines/transactions/workflows"
import { DOC_LABELS, type DocType } from "@/engines/documents/engine"

// ---------- types ----------

interface Partner { id: string; name: string; phone?: string | null }

interface Transaction {
  id: string
  title?: string | null
  tx_type: string
  state: string
  state_changed_at: string
  net_amount?: number | null
  paid_amount?: number | null
  vat_amount?: number | null
  project_name?: string | null
  created_at: string
  partner_id?: string | null
  supplier_id?: string | null
  supplier_name?: string | null
  partners?: Partner | null
  suppliers?: { id: string; name: string } | null
}

interface BusinessEvent {
  id: string
  event_type: string
  event_date: string
  title?: string | null
  description?: string | null
  created_at: string
}

interface LinkedDoc {
  id: string
  document_type: string
  document_number: string
  status: string
  net_amount?: number | null
  issue_date?: string | null
  created_at: string
}

// ---------- helpers ----------

function fmtDate(d: string) {
  if (!d) return ""
  return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—"
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function TxTypeBadge({ txType }: { txType: string }) {
  const colors: Record<string, string> = {
    sale:      "bg-blue-100 text-blue-700",
    purchase:  "bg-green-100 text-green-700",
    contract:  "bg-violet-100 text-violet-700",
    service:   "bg-amber-100 text-amber-700",
    rental:    "bg-pink-100 text-pink-700",
    transport: "bg-sky-100 text-sky-700",
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors[txType] ?? "bg-stone-100 text-stone-500"}`}>
      {TX_TYPE_LABELS[txType as TxType] ?? txType}
    </span>
  )
}

// ---------- StateProgress ----------

function StateProgress({ workflow, currentEvent }: { workflow: TxWorkflow; currentEvent: string }) {
  const currentIdx = getStepIndex(workflow, currentEvent)
  const steps = workflow.steps
  return (
    <div className="flex items-center gap-0 mt-3">
      {steps.map((step, i) => {
        const done = i <= currentIdx
        const active = i === currentIdx
        return (
          <div key={step.event} className="flex items-center flex-1 min-w-0 group">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full transition-all ${
                active ? "bg-blue-500 ring-2 ring-blue-200 scale-125"
                : done  ? "bg-emerald-400"
                : "bg-stone-200"
              }`} />
              <span className={`text-[9px] text-center leading-tight max-w-[52px] ${
                active ? "text-blue-600 font-semibold"
                : done  ? "text-stone-500"
                : "text-stone-300"
              }`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 mt-[-10px] mx-0.5 ${i < currentIdx ? "bg-emerald-300" : "bg-stone-100"}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------- DocChecklist ----------

function DocChecklist({ workflow, docs }: { workflow: TxWorkflow; docs: LinkedDoc[] }) {
  const linkedTypes = new Set(docs.map((d) => d.document_type))
  return (
    <div className="flex flex-wrap gap-2">
      {workflow.expected_docs.map((exp) => {
        const found = linkedTypes.has(exp.doc_type)
        return (
          <div key={exp.doc_type} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border ${
            found
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : exp.required
              ? "bg-red-50 border-red-200 text-red-600"
              : "bg-stone-50 border-stone-200 text-stone-400"
          }`}>
            <span className="font-mono text-[11px]">{found ? "✓" : "□"}</span>
            <span className="font-semibold">{exp.label}</span>
            {!found && exp.required && (
              <span className="text-[9px] text-red-400">ยังขาด</span>
            )}
          </div>
        )
      })}
      {docs
        .filter((d) => !workflow.expected_docs.some((e) => e.doc_type === d.document_type))
        .map((d) => {
          const label = DOC_LABELS[d.document_type as DocType]
          return (
            <div key={d.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border bg-stone-50 border-stone-200 text-stone-500">
              <span className="font-mono text-[11px]">✓</span>
              <span className="font-semibold">{label?.prefix ?? d.document_type}</span>
            </div>
          )
        })}
    </div>
  )
}

// ---------- TransactionCard (right panel) ----------

function TransactionCard({
  tx, events, docs, onAdvance, advancing, advanceMsg,
}: {
  tx: Transaction
  events: BusinessEvent[]
  docs: LinkedDoc[]
  onAdvance: (action: string, note?: string) => void
  advancing: boolean
  advanceMsg: { ok: boolean; text: string } | null
}) {
  const [note, setNote] = useState("")
  const workflow = getWorkflow(tx.tx_type)
  const nextStep = getNextStep(workflow, tx.state)
  const isPending = !isFinalEvent(workflow, tx.state)

  const outstanding =
    tx.net_amount != null
      ? (tx.net_amount ?? 0) - (tx.paid_amount ?? 0)
      : null

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">

      {/* ─── Header Card ─── */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-0.5">
            <div className="text-[10px] font-mono text-stone-400 uppercase">TX</div>
            <div className="text-base font-bold text-stone-800">
              {tx.title ?? (tx.partners as any)?.name ?? "—"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TxTypeBadge txType={tx.tx_type} />
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              tx.state === "closed"   ? "bg-stone-100 text-stone-500"
              : tx.state === "paid"  ? "bg-emerald-100 text-emerald-700"
              : tx.state === "invoiced" ? "bg-purple-100 text-purple-700"
              : "bg-blue-100 text-blue-700"
            }`}>
              {workflow.steps.find((s) => s.event === tx.state)?.label ?? tx.state}
            </span>
          </div>
        </div>

        {/* Progress */}
        <StateProgress workflow={workflow} currentEvent={tx.state} />
      </div>

      {/* ─── Parties ─── */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5">
        <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">คู่ค้า</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <div className="text-[10px] text-stone-400 mb-0.5">
              {tx.tx_type === "purchase" ? "ผู้ขาย / ซัพพลายเออร์" : "ลูกค้า / Partner"}
            </div>
            <div className="font-semibold text-stone-700">
              {(tx.partners as any)?.name ?? "—"}
            </div>
            {(tx.partners as any)?.phone && (
              <div className="text-xs text-stone-400">{(tx.partners as any).phone}</div>
            )}
          </div>
          {(tx.supplier_name || (tx.suppliers as any)?.name) && (
            <div>
              <div className="text-[10px] text-stone-400 mb-0.5">ซัพพลายเออร์</div>
              <div className="font-semibold text-stone-700">
                {(tx.suppliers as any)?.name ?? tx.supplier_name}
              </div>
            </div>
          )}
          {tx.project_name && (
            <div>
              <div className="text-[10px] text-stone-400 mb-0.5">Project</div>
              <div className="font-semibold text-stone-700 font-mono">{tx.project_name}</div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Financial Summary ─── */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5">
        <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">การเงิน</div>
        <div className="space-y-2">
          {tx.net_amount != null && (
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">มูลค่างาน</span>
              <span className="font-semibold text-stone-800">฿{fmtMoney(tx.net_amount)}</span>
            </div>
          )}
          {tx.vat_amount != null && (
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">VAT 7%</span>
              <span className="text-stone-600">฿{fmtMoney(tx.vat_amount)}</span>
            </div>
          )}
          {tx.paid_amount != null && (
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">รับแล้ว</span>
              <span className="font-semibold text-emerald-600">฿{fmtMoney(tx.paid_amount)}</span>
            </div>
          )}
          {outstanding != null && (
            <div className={`flex justify-between text-sm pt-2 border-t border-stone-100 ${outstanding > 0 ? "text-red-600" : "text-stone-500"}`}>
              <span className="font-semibold">ค้างชำระ</span>
              <span className="font-bold">฿{fmtMoney(outstanding)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── Documents Checklist ─── */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5">
        <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">เอกสาร</div>
        {docs.length === 0 && workflow.expected_docs.length === 0 ? (
          <div className="text-xs text-stone-400">ยังไม่มีเอกสาร</div>
        ) : (
          <DocChecklist workflow={workflow} docs={docs} />
        )}
        {docs.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {docs.map((doc) => {
              const meta = DOC_LABELS[doc.document_type as DocType]
              return (
                <div key={doc.id} className="flex items-center justify-between text-xs text-stone-600 py-1 border-b border-stone-50 last:border-0">
                  <span className="font-mono font-semibold">{doc.document_number}</span>
                  <span className="text-stone-400">{meta?.th ?? doc.document_type}</span>
                  {doc.net_amount != null && (
                    <span className="text-stone-700">฿{fmtMoney(doc.net_amount)}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Next Action ─── */}
      {isPending && nextStep && (
        <div className="bg-white rounded-2xl border border-stone-200 p-5">
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
            Action ถัดไป
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-sm text-stone-600">รอยืนยัน: <strong>{nextStep.label}</strong></span>
          </div>
          <button
            onClick={() => { onAdvance(nextStep.action, note || undefined); setNote("") }}
            disabled={advancing}
            className="w-full py-2.5 bg-stone-800 text-white rounded-xl text-sm font-semibold hover:bg-stone-700 disabled:opacity-40 transition"
          >
            {advancing ? "กำลังบันทึก..." : nextStep.action_label}
          </button>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="หมายเหตุ (ถ้ามี)"
            rows={2}
            className="mt-2 w-full text-xs border border-stone-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-stone-400 resize-none"
          />
          {advanceMsg && (
            <div className={`mt-2 text-xs px-3 py-1.5 rounded-lg ${advanceMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
              {advanceMsg.text}
            </div>
          )}
        </div>
      )}

      {tx.state === "closed" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center text-sm font-semibold text-emerald-700">
          ✓ ปิดงานเรียบร้อย
        </div>
      )}

      {/* ─── Timeline ─── */}
      {events.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 p-5">
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">Timeline</div>
          <div className="relative">
            <div className="absolute left-3 top-0 bottom-0 w-px bg-stone-100" />
            <div className="space-y-4">
              {events.map((ev) => (
                <div key={ev.id} className="flex gap-4 relative">
                  <div className="w-6 h-6 rounded-full bg-stone-800 shrink-0 flex items-center justify-center z-10">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-stone-700">
                        {ev.title ?? ev.event_type}
                      </span>
                      <span className="text-[10px] text-stone-400 shrink-0">{fmtDate(ev.event_date)}</span>
                    </div>
                    {ev.description && (
                      <div className="text-[11px] text-stone-500 mt-0.5">{ev.description}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ---------- props ----------

interface Props {
  mode: "browser" | "create"
  pendingOnly?: boolean
}

// ---------- main ----------

export default function TransactionPanel({ mode, pendingOnly = false }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [events, setEvents] = useState<BusinessEvent[]>([])
  const [docs, setDocs] = useState<LinkedDoc[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [advanceMsg, setAdvanceMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [filterType, setFilterType] = useState<string>("all")

  // create form state
  const [newForm, setNewForm] = useState({
    partner_id: "", tx_type: "sale", title: "", net_amount: "", vat_amount: "", project_name: "",
  })
  const [creating, setCreating] = useState(false)

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (pendingOnly) params.set("pending", "1")
      if (filterType !== "all") params.set("tx_type", filterType)
      const res = await fetch(`/api/admin/transactions?${params}`)
      const data = await res.json()
      setTransactions(data.transactions ?? [])
    } finally {
      setLoading(false)
    }
  }, [pendingOnly, filterType])

  const loadPartners = useCallback(async () => {
    const res = await fetch("/api/admin/partners")
    const data = await res.json()
    setPartners(data.partners ?? [])
  }, [])

  useEffect(() => { loadTransactions() }, [loadTransactions])
  useEffect(() => { if (mode === "create") loadPartners() }, [mode, loadPartners])

  async function selectTransaction(tx: Transaction) {
    setSelected(tx)
    setAdvanceMsg(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/transactions/${tx.id}`)
      const data = await res.json()
      setEvents(data.events ?? [])
      setDocs(data.documents ?? [])
      if (data.transaction) setSelected(data.transaction)
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleAdvance(action: string, note?: string) {
    if (!selected) return
    setAdvancing(true)
    setAdvanceMsg(null)
    try {
      const res = await fetch(`/api/admin/transactions/${selected.id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "เกิดข้อผิดพลาด")
      const wf = getWorkflow(selected.tx_type)
      const step = wf.steps.find((s) => s.action === action)
      setSelected(data.transaction)
      setEvents(data.events ?? [])
      setDocs(data.documents ?? [])
      setAdvanceMsg({ ok: true, text: `✓ ${step?.action_label ?? action}` })
      setTransactions((prev) => prev.map((t) =>
        t.id === selected.id ? { ...t, state: data.new_state } : t
      ))
    } catch (e: unknown) {
      setAdvanceMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" })
    } finally {
      setAdvancing(false)
    }
  }

  async function createTransaction() {
    if (!newForm.partner_id) return
    setCreating(true)
    try {
      const res = await fetch("/api/admin/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner_id: newForm.partner_id,
          tx_type: newForm.tx_type,
          title: newForm.title || undefined,
          net_amount: newForm.net_amount ? parseFloat(newForm.net_amount) : undefined,
          vat_amount: newForm.vat_amount ? parseFloat(newForm.vat_amount) : undefined,
          project_name: newForm.project_name || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "สร้างไม่สำเร็จ")
      setNewForm({ partner_id: "", tx_type: "sale", title: "", net_amount: "", vat_amount: "", project_name: "" })
      await loadTransactions()
      if (data.transaction) selectTransaction(data.transaction)
    } finally {
      setCreating(false)
    }
  }

  // ---- List item ----
  function TxListItem({ tx }: { tx: Transaction }) {
    const wf = getWorkflow(tx.tx_type)
    const stepLabel = wf.steps.find((s) => s.event === tx.state)?.label ?? tx.state
    const isPending = !isFinalEvent(wf, tx.state)
    return (
      <button
        onClick={() => selectTransaction(tx)}
        className={`w-full text-left px-4 py-3 hover:bg-stone-50 transition ${selected?.id === tx.id ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-stone-700 truncate">
            {(tx.partners as any)?.name ?? "—"}
          </span>
          <TxTypeBadge txType={tx.tx_type} />
        </div>
        <div className="flex items-center justify-between mt-1 gap-2">
          <div className="flex items-center gap-1.5">
            {isPending && <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
            <span className={`text-[10px] ${isPending ? "text-amber-700 font-semibold" : "text-stone-400"}`}>
              {stepLabel}
            </span>
          </div>
          {tx.net_amount != null && (
            <span className="text-xs font-semibold text-stone-600 shrink-0">
              ฿{fmtMoney(tx.net_amount)}
            </span>
          )}
        </div>
        {tx.project_name && (
          <div className="text-[10px] text-stone-400 mt-0.5 font-mono truncate">{tx.project_name}</div>
        )}
      </button>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left: list ── */}
      <div className="w-72 shrink-0 border-r border-stone-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-stone-100">
          <div className="font-semibold text-stone-800 text-sm">
            {pendingOnly ? "งานค้าง" : "Transaction ทั้งหมด"}
          </div>
          {/* Filter by tx_type */}
          <div className="flex flex-wrap gap-1 mt-2">
            <button
              onClick={() => setFilterType("all")}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${filterType === "all" ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"}`}
            >
              ทั้งหมด
            </button>
            {TX_TYPE_ORDER.map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${filterType === t ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"}`}
              >
                {TX_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Create form */}
        {mode === "create" && (
          <div className="px-4 py-3 border-b border-stone-100 space-y-2">
            <div className="flex gap-1 flex-wrap">
              {TX_TYPE_ORDER.map((t) => (
                <button
                  key={t}
                  onClick={() => setNewForm((f) => ({ ...f, tx_type: t }))}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition border ${newForm.tx_type === t ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}
                >
                  {TX_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <select
              value={newForm.partner_id}
              onChange={(e) => setNewForm((f) => ({ ...f, partner_id: e.target.value }))}
              className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-stone-400"
            >
              <option value="">— เลือก Partner —</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input
              value={newForm.project_name}
              onChange={(e) => setNewForm((f) => ({ ...f, project_name: e.target.value }))}
              placeholder="Project (เช่น KKN-001)"
              className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-stone-400 font-mono"
            />
            <input
              value={newForm.title}
              onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="ชื่องาน (ถ้ามี)"
              className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-stone-400"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                value={newForm.net_amount}
                onChange={(e) => setNewForm((f) => ({ ...f, net_amount: e.target.value }))}
                placeholder="มูลค่า (บาท)"
                className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-stone-400 text-right"
              />
              <input
                type="number"
                value={newForm.vat_amount}
                onChange={(e) => setNewForm((f) => ({ ...f, vat_amount: e.target.value }))}
                placeholder="VAT (บาท)"
                className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-stone-400 text-right"
              />
            </div>
            <button
              onClick={createTransaction}
              disabled={!newForm.partner_id || creating}
              className="w-full py-1.5 bg-stone-800 text-white text-xs rounded-lg font-semibold disabled:opacity-40 hover:bg-stone-700 transition"
            >
              {creating ? "กำลังเปิดงาน..." : "+ เปิดงานใหม่"}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-stone-50">
          {loading && <div className="text-center text-xs text-stone-400 py-8 animate-pulse">โหลด...</div>}
          {!loading && transactions.length === 0 && (
            <div className="text-center text-xs text-stone-400 py-8">
              {pendingOnly ? "ไม่มีงานค้าง" : "ยังไม่มี transaction"}
            </div>
          )}
          {transactions.map((tx) => <TxListItem key={tx.id} tx={tx} />)}
        </div>
      </div>

      {/* ── Right: detail ── */}
      <div className="flex-1 overflow-y-auto bg-stone-50">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm">
            เลือกงานจากรายการด้านซ้าย
          </div>
        ) : detailLoading ? (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm animate-pulse">โหลด...</div>
        ) : (
          <TransactionCard
            tx={selected}
            events={events}
            docs={docs}
            onAdvance={handleAdvance}
            advancing={advancing}
            advanceMsg={advanceMsg}
          />
        )}
      </div>
    </div>
  )
}
