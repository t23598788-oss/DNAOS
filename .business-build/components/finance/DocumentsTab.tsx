"use client"

import { useEffect, useState } from "react"

// DocumentsTab (UNIFIED FINANCE ADMIN mission, 2026-10-11) — เอกสารการเงิน
// ใช้ Document Engine เดิมทั้งหมด: รายการจาก GET /api/admin/documents
// (canonical invoices + standalone_documents) · เปิด/ดาวน์โหลด/พิมพ์ ทำที่
// /admin/documents (workspace เดิม) · สร้างเอกสารใหม่ใช้หน้าเดิม
// (/admin/invoice /admin/receipt /admin/payment-voucher ...) — ไม่มี
// document store ใหม่ ไม่มีเอกสารการเงินสร้างซ้ำ

interface DocRow {
  id: string
  document_type: string
  document_number: string
  status: string
  party_name: string
  net_amount: number
  issue_date: string | null
  created_at: string
  artifact: { present: boolean; pdf: boolean; png: boolean }
}

const TYPE_LABELS: Record<string, string> = {
  invoice: "ใบแจ้งหนี้",
  receipt: "ใบเสร็จ / ใบรับเงิน",
  tax_invoice: "ใบกำกับภาษี",
  payment_voucher: "ใบสำคัญจ่าย",
  quotation: "ใบเสนอราคา",
  billing: "ใบวางบิล",
  delivery_order: "ใบส่งของ",
  purchase_order: "ใบสั่งซื้อ",
  credit_note: "ใบลดหนี้",
  debit_note: "ใบเพิ่มหนี้",
}

const thb = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const CREATE_LINKS = [
  { href: "/admin/invoice", label: "สร้างใบแจ้งหนี้" },
  { href: "/admin/receipt", label: "สร้างใบเสร็จ/ใบรับเงิน" },
  { href: "/admin/payment-voucher", label: "สร้างใบสำคัญจ่าย" },
  { href: "/admin/purchase-order", label: "สร้างใบสั่งซื้อ" },
  { href: "/admin/delivery-order", label: "สร้างใบส่งของ" },
]

export default function DocumentsTab() {
  const [docs, setDocs] = useState<DocRow[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    fetch("/api/admin/documents?perPage=15")
      .then((r) => r.json())
      .then((d) => { setDocs(d.documents ?? []); setTotal(d.total ?? 0) })
      .catch(() => setDocs([]))
  }, [])

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <a href="/admin/documents" className="text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-900">
          เปิดคลังเอกสารทั้งหมด (เปิด PDF · ดูรูป · ดาวน์โหลด · พิมพ์)
        </a>
        {CREATE_LINKS.map((l) => (
          <a key={l.href} href={l.href} className="text-sm px-3 py-1.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50">
            {l.label}
          </a>
        ))}
      </div>

      <div className="text-xs font-semibold text-stone-600 mb-2">เอกสารการเงินล่าสุด (canonical — ไม่แยก Manual/Automation)</div>
      <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 bg-white">
        {docs.length === 0 && <div className="px-3 py-3 text-sm text-stone-400">ไม่มีเอกสาร</div>}
        {docs.map((d) => (
          <a key={d.id} href={`/admin/documents?docId=${d.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-stone-50">
            <div className="min-w-0">
              <span className="text-stone-800">{d.document_number}</span>
              <span className="text-xs text-stone-400 ml-2">{TYPE_LABELS[d.document_type] ?? d.document_type} · {d.party_name} · {d.status}</span>
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap">
              {d.artifact?.pdf && <span className="text-xs text-red-500 border border-red-200 rounded px-1">PDF</span>}
              <span className="font-semibold">{thb(d.net_amount ?? 0)} ฿</span>
            </div>
          </a>
        ))}
      </div>
      {total > docs.length && (
        <a href="/admin/documents" className="inline-block mt-2 text-xs text-blue-600 underline">ดูทั้งหมด {total} ฉบับ →</a>
      )}
    </div>
  )
}
