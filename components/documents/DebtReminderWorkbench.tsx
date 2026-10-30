'use client'

/**
 * Debt Collection Workbench (M026) — a tab inside the existing debt-tracking
 * workspace, not a second application.
 *
 * Every number shown here comes from the same canonical readers the cron uses
 * (`invoice_payment_summary` via readCompanyInvoiceDebt, `company_debt_position`
 * for the invoice/ledger reconciliation). The buttons only write PREVIEW audit
 * rows; the server refuses anything else unless SAFE PREVIEW MODE is off, and
 * this screen says so in the banner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface PreviewMessage {
  state: 'BEFORE_DUE' | 'DUE_TODAY' | 'OVERDUE'
  label: string
  text: string
}

interface HistoryRow {
  id: string
  at: string | null
  documentNo: string | null
  state: string | null
  status: string
  mode: 'LIVE' | 'PREVIEW'
  error: string | null
  lineMessageId: string | null
}

interface WorkbenchRow {
  companyId: string
  companyName: string
  invoiceId: string
  invoiceNo: string
  receivable: number
  paid: number
  outstanding: number
  dueDate: string
  daysOverdue: number
  trackingStatus: 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'PAID' | 'VOID'
  reconciliation: {
    invoiceOutstanding: number
    ledgerOutstanding: number
    linkedLedgerNet: number
    positionOutstanding: number
    status: string
    duplicateSuppressed: boolean
    snapshotMatchesLedger: boolean
  } | null
  recipient: {
    ok: boolean
    lineUserId: string | null
    role: string | null
    trust: string | null
    reason: string | null
    consent: 'ALLOWED' | 'OPTED_OUT' | 'NOT_CONFIGURED' | 'UNKNOWN'
  }
  previews: PreviewMessage[]
  history: HistoryRow[]
}

interface Workbench {
  previewMode: boolean
  generatedAt: string
  businessDate: string
  summary: {
    companies: number
    openInvoices: number
    totalOutstanding: number
    overdueInvoices: number
    dueSoonInvoices: number
    blockedRecipients: number
  }
  companies: { id: string; name: string }[]
  rows: WorkbenchRow[]
  history: HistoryRow[]
}

const STATUS_LABEL: Record<string, string> = {
  CURRENT: 'ยังไม่ครบกำหนด',
  DUE_SOON: 'ใกล้ครบกำหนด',
  OVERDUE: 'เกินกำหนด',
  PAID: 'ชำระครบ',
  VOID: 'ยกเลิก',
}

const STATUS_CLASS: Record<string, string> = {
  CURRENT: 'bg-sky-50 text-sky-700 border-sky-200',
  DUE_SOON: 'bg-amber-50 text-amber-700 border-amber-200',
  OVERDUE: 'bg-rose-50 text-rose-700 border-rose-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  VOID: 'bg-stone-100 text-stone-500 border-stone-200',
}

const SEND_STATUS_LABEL: Record<string, string> = {
  sent: 'ผู้ให้บริการรับคำขอ',
  failed: 'ล้มเหลว',
  cancelled: 'ยกเลิก (มียอดเปลี่ยน)',
  queued: 'รอส่ง',
  preview: 'ทดสอบ (ไม่ได้ส่งจริง)',
}

function money(n: number) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const parsed = new Date(`${d.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmtDateTime(d: string | null) {
  if (!d) return '—'
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return d
  return parsed.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

export default function DebtReminderWorkbench() {
  const [data, setData] = useState<Workbench | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
      const res = await fetch(`/api/admin/debt-reminder-workbench${qs}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? `โหลดข้อมูลไม่สำเร็จ (${res.status})`)
        setData(null)
        return
      }
      setData(json as Workbench)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  const rows = data?.rows ?? []
  const openRows = useMemo(
    () => rows.filter((r) => r.outstanding > 0 && r.trackingStatus !== 'VOID'),
    [rows],
  )

  async function mockSend(row: WorkbenchRow, state: PreviewMessage['state']) {
    const key = `${row.invoiceId}:${state}`
    setSending(key)
    setSendResult(null)
    try {
      const res = await fetch('/api/admin/debt-reminder-workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: row.companyId, invoiceId: row.invoiceId, state }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSendResult({ ok: false, text: json?.error ?? `ล้มเหลว (${res.status})` })
      } else {
        setSendResult({
          ok: true,
          text: `${json.note}\n\n— ข้อความที่บันทึกเป็นหลักฐาน —\n${json.text}`,
        })
        await load()
      }
    } catch (e) {
      setSendResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {data?.previewMode && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="text-xs font-bold text-amber-900">SAFE PREVIEW MODE</div>
          <div className="mt-1 text-[11px] leading-relaxed text-amber-800">
            สภาพแวดล้อมนี้ไม่ส่ง LINE จริงทุกช่องทาง (Cron และปุ่มส่งถูกปิด) — ปุ่มทดสอบจะบันทึกหลักฐานแบบ
            PREVIEW เท่านั้น และใช้ข้อมูลตัวอย่างเท่านั้น
          </div>
        </div>
      )}

      {data && !data.previewMode && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3">
          <div className="text-xs font-bold text-rose-900">โหมดส่งจริง</div>
          <div className="mt-1 text-[11px] text-rose-800">
            DEBT_REMINDER_PREVIEW_MODE ไม่ได้เปิด — ปุ่มทดสอบจะถูกปฏิเสธจากเซิร์ฟเวอร์
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm font-bold text-stone-800">ติดตามหนี้ — ใบแจ้งหนี้ค้างชำระ</div>
        <select
          className="text-xs border border-stone-200 rounded-lg px-2 py-1.5 bg-white"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          <option value="">ทุกบริษัท (ตามสิทธิ์ที่เห็น)</option>
          {(data?.companies ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          className="text-xs border border-stone-200 rounded-lg px-2 py-1.5 bg-white hover:bg-stone-50"
          onClick={load}
          disabled={loading}
        >
          {loading ? 'กำลังโหลด...' : 'โหลดใหม่'}
        </button>
        {data && (
          <span className="text-[10px] text-stone-400">
            ณ {fmtDateTime(data.generatedAt)} · วันที่ธุรกิจ {data.businessDate}
          </span>
        )}
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: 'บริษัทลูกหนี้', value: String(data.summary.companies) },
            { label: 'ใบแจ้งหนี้ค้าง', value: String(data.summary.openInvoices) },
            { label: 'ยอดคงเหลือรวม', value: `${money(data.summary.totalOutstanding)} ฿` },
            { label: 'เกินกำหนด', value: String(data.summary.overdueInvoices) },
            { label: 'ผู้รับถูกบล็อก', value: String(data.summary.blockedRecipients) },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-stone-200 bg-white px-3 py-2">
              <div className="text-[10px] text-stone-400">{card.label}</div>
              <div className="text-sm font-bold text-stone-800">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          {error}
        </div>
      )}

      {sendResult && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs whitespace-pre-wrap ${
            sendResult.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-rose-300 bg-rose-50 text-rose-900'
          }`}
        >
          {sendResult.text}
        </div>
      )}

      {!loading && !error && openRows.length === 0 && (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-10 text-center text-sm text-stone-400">
          ยังไม่มียอดค้างชำระตามสิทธิ์ที่บัญชีนี้เห็น
        </div>
      )}

      {openRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold text-stone-500">ลูกหนี้ / เจ้าหนี้</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">เลขที่ใบแจ้งหนี้</th>
                <th className="text-right px-3 py-2.5 font-semibold text-stone-500">ยอดเดิม</th>
                <th className="text-right px-3 py-2.5 font-semibold text-stone-500">ชำระแล้ว</th>
                <th className="text-right px-3 py-2.5 font-semibold text-stone-500">คงเหลือ</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">ครบกำหนด</th>
                <th className="text-right px-3 py-2.5 font-semibold text-stone-500">เกิน (วัน)</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">สถานะติดตาม</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">ผู้รับ</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {openRows.map((row) => {
                const key = row.invoiceId
                const isOpen = expanded === key
                return (
                  <FragmentRow
                    key={key}
                    row={row}
                    isOpen={isOpen}
                    sending={sending}
                    onToggle={() => setExpanded(isOpen ? null : key)}
                    onMockSend={mockSend}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FragmentRow({
  row,
  isOpen,
  sending,
  onToggle,
  onMockSend,
}: {
  row: WorkbenchRow
  isOpen: boolean
  sending: string | null
  onToggle: () => void
  onMockSend: (row: WorkbenchRow, state: PreviewMessage['state']) => void
}) {
  return (
    <>
      <tr className="hover:bg-stone-50 transition">
        <td className="px-4 py-3">
          <div className="font-semibold text-stone-800">{row.companyName}</div>
          <div className="text-[10px] text-stone-400">
            {row.reconciliation ? `กระทบยอด: ${row.reconciliation.status}` : 'ไม่มีข้อมูลกระทบยอด'}
            {row.reconciliation?.duplicateSuppressed ? ' · ระงับการนับซ้ำ' : ''}
          </div>
        </td>
        <td className="px-3 py-3 text-stone-600">{row.invoiceNo}</td>
        <td className="px-3 py-3 text-right text-stone-600">{money(row.receivable)}</td>
        <td className="px-3 py-3 text-right text-stone-600">{money(row.paid)}</td>
        <td className="px-3 py-3 text-right font-semibold text-stone-900">{money(row.outstanding)}</td>
        <td className="px-3 py-3 text-stone-600">{fmtDate(row.dueDate)}</td>
        <td className={`px-3 py-3 text-right ${row.daysOverdue > 0 ? 'text-rose-600 font-semibold' : 'text-stone-400'}`}>
          {row.daysOverdue}
        </td>
        <td className="px-3 py-3">
          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] ${STATUS_CLASS[row.trackingStatus] ?? ''}`}>
            {STATUS_LABEL[row.trackingStatus] ?? row.trackingStatus}
          </span>
        </td>
        <td className="px-3 py-3">
          {row.recipient.ok ? (
            <div className="text-[10px] text-stone-600">
              <div className="font-semibold">{row.recipient.role} · {row.recipient.trust}</div>
              <div className="text-stone-400">{row.recipient.lineUserId}</div>
              <div className={row.recipient.consent === 'OPTED_OUT' ? 'text-rose-600' : 'text-stone-400'}>
                {row.recipient.consent === 'OPTED_OUT' ? 'ปฏิเสธรับข้อความ' : row.recipient.consent === 'ALLOWED' ? 'อนุญาตแล้ว' : 'ค่าเริ่มต้น'}
              </div>
            </div>
          ) : (
            <span className="inline-block rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
              บล็อก: {row.recipient.reason}
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-right">
          <button
            className="text-[11px] border border-stone-200 rounded-lg px-2 py-1 bg-white hover:bg-stone-50"
            onClick={onToggle}
          >
            {isOpen ? 'ซ่อน' : 'ดูข้อความ / ประวัติ'}
          </button>
        </td>
      </tr>

      {isOpen && (
        <tr className="bg-stone-50/60">
          <td colSpan={10} className="px-4 py-4">
            <div className="grid gap-3 lg:grid-cols-3">
              {row.previews.map((preview) => {
                const busy = sending === `${row.invoiceId}:${preview.state}`
                return (
                  <div key={preview.state} className="rounded-xl border border-stone-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold text-stone-700">{preview.label}</div>
                      <span className="text-[10px] text-stone-400">{preview.state}</span>
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-stone-700 font-sans">{preview.text}</pre>
                    <button
                      className="mt-2 w-full text-[11px] rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                      disabled={!row.recipient.ok || busy}
                      onClick={() => onMockSend(row, preview.state)}
                      title={row.recipient.ok ? 'บันทึกหลักฐานแบบ PREVIEW — ไม่ส่งจริง' : `ผู้รับถูกบล็อก: ${row.recipient.reason}`}
                    >
                      {busy ? 'กำลังบันทึก...' : 'ทดสอบส่ง (จำลอง — ไม่ส่งจริง)'}
                    </button>
                  </div>
                )
              })}
            </div>

            {row.reconciliation && (
              <div className="mt-3 grid gap-2 rounded-xl border border-stone-200 bg-white p-3 text-[11px] text-stone-600 md:grid-cols-4">
                <div>ยอดตามใบแจ้งหนี้: <b>{money(row.reconciliation.invoiceOutstanding)}</b></div>
                <div>ยอดตาม ledger: <b>{money(row.reconciliation.ledgerOutstanding)}</b></div>
                <div>ledger ที่ผูกกับ invoice: <b>{money(row.reconciliation.linkedLedgerNet)}</b></div>
                <div>snapshot ตรง ledger: <b>{row.reconciliation.snapshotMatchesLedger ? 'ตรง' : 'ไม่ตรง'}</b></div>
              </div>
            )}

            <div className="mt-3 rounded-xl border border-stone-200 bg-white">
              <div className="border-b border-stone-100 px-3 py-2 text-[11px] font-bold text-stone-700">
                ประวัติการส่ง (จาก line_events)
              </div>
              {row.history.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-stone-400">ยังไม่มีประวัติสำหรับเอกสารนี้</div>
              ) : (
                <table className="w-full text-[11px]">
                  <tbody className="divide-y divide-stone-100">
                    {row.history.map((h) => (
                      <tr key={h.id}>
                        <td className="px-3 py-1.5 text-stone-500">{fmtDateTime(h.at)}</td>
                        <td className="px-3 py-1.5 text-stone-600">{h.state ?? '—'}</td>
                        <td className="px-3 py-1.5">
                          <span className={h.mode === 'PREVIEW' ? 'text-amber-700' : h.status === 'failed' ? 'text-rose-600' : 'text-stone-700'}>
                            {SEND_STATUS_LABEL[h.status] ?? h.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-stone-400">{h.mode}</td>
                        <td className="px-3 py-1.5 text-stone-400">{h.error ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
