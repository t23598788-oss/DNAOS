"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

// DOCUMENTS workspace (owner mission 2026-10-10, FINANCIAL DOCUMENT MANAGEMENT).
// พื้นที่จัดการเอกสารแยกจากหน้าจอแชท LINE: ค้นหา/เปิด/ดาวน์โหลด/พิมพ์/ตรวจ
// หลักฐาน ทุกอย่างเรียก canonical API เดิม (/api/admin/documents) ห้ามมี
// document store ใหม่ และห้ามผูก Document Management เข้ากับ LINE chat

const TYPE_LABELS: Record<string, string> = {
  invoice: "ใบแจ้งหนี้",
  receipt: "ใบเสร็จ / ใบรับเงิน",
  tax_invoice: "ใบกำกับภาษี",
  quotation: "ใบเสนอราคา",
  billing: "ใบวางบิล",
  delivery_order: "ใบส่งของ",
  purchase_order: "ใบสั่งซื้อ",
  boq: "ใบประมาณปริมาณงาน",
  credit_note: "ใบลดหนี้",
  debit_note: "ใบเพิ่มหนี้",
  payment_voucher: "ใบสำคัญจ่าย",
}

interface DocRow {
  id: string
  document_type: string
  document_number: string
  status: string
  party_name: string
  net_amount: number
  reference_number: string | null
  issue_date: string | null
  created_at: string
  artifact: { present: boolean; produced_by: string | null; pdf: boolean; png: boolean }
}

interface History {
  versions: Array<Record<string, unknown>>
  artifacts: Array<Record<string, unknown>>
  audit: Array<Record<string, unknown>>
  delivery: Array<Record<string, unknown>>
}

const thb = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const date10 = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "-")

export default function DocumentsPage() {
  const [rows, setRows] = useState<DocRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [type, setType] = useState("")
  const [status, setStatus] = useState("")
  const [reference, setReference] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [minAmount, setMinAmount] = useState("")
  const [maxAmount, setMaxAmount] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileOrigin, setFileOrigin] = useState<string>("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (search.trim()) params.set("search", search.trim())
    if (type) params.set("type", type)
    if (status.trim()) params.set("status", status.trim())
    if (reference.trim()) params.set("reference", reference.trim())
    if (dateFrom) params.set("dateFrom", dateFrom)
    if (dateTo) params.set("dateTo", dateTo)
    if (minAmount) params.set("minAmount", minAmount)
    if (maxAmount) params.set("maxAmount", maxAmount)
    params.set("perPage", "100")
    try {
      const res = await fetch(`/api/admin/documents?${params.toString()}`)
      const data = await res.json()
      if (Array.isArray(data.documents)) {
        setRows(data.documents)
        setTotal(data.total ?? data.documents.length)
      } else {
        setError(data.error ?? "โหลดเอกสารไม่สำเร็จ")
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [search, type, status, reference, dateFrom, dateTo, minAmount, maxAmount])

  useEffect(() => { void load() }, [load])

  const openDoc = useCallback(async (id: string, kind: "pdf" | "png" = "pdf") => {
    setSelected(id)
    setFileUrl(null)
    const res = await fetch(`/api/admin/documents/${id}/file?kind=${kind}&source=auto`)
    if (res.ok) {
      const blob = await res.blob()
      setFileUrl(URL.createObjectURL(blob))
      setFileOrigin(res.headers.get("x-document-file-origin") ?? "")
    } else {
      const body = await res.json().catch(() => null)
      setFileOrigin(body?.error ?? `เปิดไฟล์ไม่สำเร็จ (HTTP ${res.status})`)
    }
    const hist = await fetch(`/api/admin/documents/${id}`).then((r) => r.json()).catch(() => null)
    setHistory(hist?.history ?? null)
  }, [])

  const filterActive = useMemo(
    () => Boolean(search || type || status || reference || dateFrom || dateTo || minAmount || maxAmount),
    [search, type, status, reference, dateFrom, dateTo, minAmount, maxAmount],
  )

  return (
    <div style={{ padding: 24, fontFamily: "inherit", maxWidth: 1200 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>เอกสารทั้งหมด</h1>
      <p style={{ fontSize: 12, color: "var(--dna-muted-2)", marginBottom: 16 }}>
        ค้นหา เปิดดู ดาวน์โหลด พิมพ์ และตรวจสอบหลักฐานเอกสาร — อ่านจาก canonical record เดิม
        (invoices / standalone_documents → document_versions → document_artifacts → storage) ไม่มีเอกสารชุดใหม่
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อบริษัท หรือเลขเอกสาร" style={input} />
        <select value={type} onChange={(e) => setType(e.target.value)} style={input}>
          <option value="">ทุกประเภทธุรกรรม</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="สถานะเอกสาร" style={input} />
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="เลขอ้างอิง" style={input} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={input} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={input} />
        <input type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="จำนวนเงินต่ำสุด" style={input} />
        <input type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="จำนวนเงินสูงสุด" style={input} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <button onClick={() => void load()} style={primaryBtn}>ค้นหา</button>
        {filterActive && (
          <button
            onClick={() => { setSearch(""); setType(""); setStatus(""); setReference(""); setDateFrom(""); setDateTo(""); setMinAmount(""); setMaxAmount("") }}
            style={ghostBtn}
          >
            ล้างตัวกรอง
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--dna-muted-2)" }}>{loading ? "กำลังโหลด..." : `พบ ${rows.length} / ${total} รายการ`}</span>
      </div>

      {error && <div style={{ background: "color-mix(in srgb, #ef4444 12%, var(--dna-surface))", border: "1px solid color-mix(in srgb, #ef4444 35%, var(--dna-border))", color: "var(--dna-ink)", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: 16 }}>
        <div style={{ border: "1px solid var(--dna-border)", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--dna-surface-2)", textAlign: "left" }}>
                <th style={th}>เลขเอกสาร</th>
                <th style={th}>ประเภท</th>
                <th style={th}>คู่ค้า</th>
                <th style={th}>วันที่</th>
                <th style={{ ...th, textAlign: "right" }}>จำนวนเงิน</th>
                <th style={th}>ไฟล์</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.id}:${r.document_type}`}
                  onClick={() => void openDoc(r.id)}
                  style={{ cursor: "pointer", background: selected === r.id ? "color-mix(in srgb, #2563eb 10%, var(--dna-surface))" : undefined, borderTop: "1px solid var(--dna-border)" }}
                >
                  <td style={td}>{r.document_number || "-"}</td>
                  <td style={td}>{TYPE_LABELS[r.document_type] ?? r.document_type}</td>
                  <td style={td}>{r.party_name || "-"}</td>
                  <td style={td}>{date10(r.issue_date)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{thb(r.net_amount)}</td>
                  <td style={td}>{r.artifact?.present ? "✅" : "—"}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "var(--dna-muted-2)", padding: 24 }}>{loading ? "กำลังโหลด..." : "ไม่พบเอกสาร"}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ border: "1px solid var(--dna-border)", borderRadius: 8, padding: 16, alignSelf: "start" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <a href={`/api/admin/documents/${selected}/file?kind=pdf&source=auto`} target="_blank" rel="noreferrer" style={primaryBtn}>เปิด PDF</a>
              <a href={`/api/admin/documents/${selected}/file?kind=png&source=auto`} target="_blank" rel="noreferrer" style={ghostBtn}>เปิด PNG</a>
              <a href={`/api/admin/documents/${selected}/file?kind=pdf&source=auto&download=1`} style={ghostBtn}>ดาวน์โหลด PDF</a>
              <button onClick={() => { if (fileUrl) window.print() }} style={ghostBtn}>พิมพ์</button>
            </div>
            {fileOrigin && <div style={{ fontSize: 11, color: "var(--dna-muted)", marginBottom: 8 }}>ต้นทางไฟล์: <code>{fileOrigin}</code></div>}
            {fileUrl && <img src={fileUrl} alt="เอกสาร" style={{ width: "100%", border: "1px solid var(--dna-border)", borderRadius: 6, marginBottom: 12 }} />}

            <h2 style={{ fontSize: 14, fontWeight: 700, margin: "12px 0 6px" }}>ประวัติ &amp; หลักฐาน</h2>
            {!history && <div style={{ fontSize: 12, color: "var(--dna-muted-2)" }}>กำลังโหลดประวัติ...</div>}
            {history && (
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 6 }}>เวอร์ชันเอกสาร: <b>{history.versions.length}</b></div>
                <div style={{ marginBottom: 6 }}>Artifact (metadata จับคู่ไฟล์): <b>{history.artifacts.length}</b></div>
                <div style={{ marginBottom: 6 }}>Audit log: <b>{history.audit.length}</b></div>
                <div style={{ marginBottom: 6 }}>หลักฐานการส่ง (LINE): <b>{history.delivery.length}</b>{history.delivery.length === 0 && " (ยังไม่เคยส่งออก)"}</div>
                {history.artifacts.length > 0 && (
                  <div style={{ marginTop: 8, background: "var(--dna-surface-2)", borderRadius: 6, padding: 8 }}>
                    {history.artifacts.slice(0, 4).map((a, i) => (
                      <div key={i} style={{ marginBottom: 4, wordBreak: "break-all" }}>
                        <code>{String(a.produced_by ?? "")}</code> · {String(a.kind ?? "")} · sha256 <code>{String(a.sha256 ?? "").slice(0, 16)}…</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ONE AI SURFACE (owner 2026-10-18): กล่อง "ถาม AI เรื่องเอกสาร" ถูกถอดออก —
          Workspace มีช่อง AI หลัก (composer) อยู่แล้ว · ไม่สร้างช่องถาม/แชตใหม่แทน
          · หน้านี้คงไว้เฉพาะตาราง/ตัวกรอง/ค้นหา/เครื่องมือจัดการเอกสารเดิม */}
    </div>
  )
}

const input: React.CSSProperties = { border: "1px solid var(--dna-border-strong)", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "var(--dna-surface)", color: "var(--dna-ink)" }
const primaryBtn: React.CSSProperties = { background: "var(--dna-button)", color: "var(--dna-on-button)", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", display: "inline-block", textDecoration: "none" }
const ghostBtn: React.CSSProperties = { background: "var(--dna-surface)", color: "var(--dna-ink)", borderRadius: 6, padding: "8px 12px", fontSize: 12, border: "1px solid var(--dna-border-strong)", cursor: "pointer", display: "inline-block", textDecoration: "none" }
const th: React.CSSProperties = { padding: "8px 10px", fontSize: 11, fontWeight: 600, color: "var(--dna-muted)", borderBottom: "1px solid var(--dna-border)" }
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--dna-border)" }

