/**
 * /examples — Screen-to-Command mapping
 *
 * UI designer เปิดหน้านี้แล้วรู้ทันทีว่า:
 * - แต่ละหน้าจอต้องดึงข้อมูลจาก command อะไร
 * - data structure ที่ได้หน้าตาอย่างไร
 * - ต้องใช้ token หรือเปล่า
 *
 * Static — no DB
 */

import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Examples | DNA OS",
  description: "Screen-to-Command mapping — แต่ละหน้าจอใช้ command อะไร โครงสร้างข้อมูลที่ได้เป็นอย่างไร และต้องใช้ token หรือไม่",
  alternates: { canonical: "/examples" },
  openGraph: {
    title: "Examples | DNA OS",
    description: "Screen-to-Command mapping ของ DNA OS",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Examples | DNA OS",
    description: "Screen-to-Command mapping ของ DNA OS",
    images: ["/opengraph-image"],
  },
}

interface ScreenExample {
  id: string
  name: string
  name_th: string
  category: string
  description: string
  commands: {
    command: string
    purpose: string
    args?: string
    output: string
  }[]
  data_shape: string
  notes?: string
}

const EXAMPLES: ScreenExample[] = [
  {
    id: "partner-list",
    name: "Partner List",
    name_th: "รายชื่อคู่ค้า",
    category: "Relationship",
    description: "ตารางคู่ค้าทั้งหมดพร้อมสรุปยอดเงิน — ใช้แทนมุมมองที่เน้นเอกสาร",
    commands: [
      {
        command: "partner.list",
        purpose: "ดึงคู่ค้าทั้งหมดพร้อม summary ยอดเงิน",
        output: "PartnerSummary[] — id, name, total_invoiced, total_received, outstanding, last_activity",
      },
    ],
    data_shape: `PartnerSummary {
  id: string
  name: string
  partner_type_label: string | null
  phone: string | null
  total_invoiced: number
  total_received: number
  outstanding: number
  last_activity: string | null
  document_count: number
}`,
    notes: "เรียงตาม last_activity จากปัจจุบันย้อนหลัง",
  },
  {
    id: "partner-timeline",
    name: "Partner Timeline",
    name_th: "Business Timeline ของคู่ค้า",
    category: "Relationship",
    description: "ประวัติ Event และเอกสารทั้งหมดของคู่ค้าคนหนึ่ง เรียงตามวันที่",
    commands: [
      {
        command: "partner.timeline",
        purpose: "ดึง timeline + summary ของคู่ค้า",
        args: '{ "partner_id": "uuid" }',
        output: "{ summary: PartnerSummary, timeline: PartnerTimelineEntry[] }",
      },
    ],
    data_shape: `PartnerTimelineEntry {
  date: string
  kind: "document" | "business_event"
  event_type: string
  title: string
  subtitle: string | null
  amount: number | null
  status: string | null
  document_id?: string
  document_number?: string
  business_event_id?: string
}`,
    notes: "Partner Timeline เป็น Event-Centric — เอกสารเป็น artifact ของ event ไม่ใช่ตัว event เอง",
  },
  {
    id: "invoice-list",
    name: "Invoice List",
    name_th: "รายการใบแจ้งหนี้",
    category: "Documents",
    description: "ตารางใบแจ้งหนี้ทั้งหมด — ใช้ partner.timeline แทนถ้าต้องการดูในบริบทของคู่ค้า",
    commands: [
      {
        command: "invoice.list",
        purpose: "ดึงเอกสารทุกชิ้นที่เป็น invoice",
        output: "Document[] — document_type=invoice",
      },
      {
        command: "invoice.latest",
        purpose: "ดึงใบแจ้งหนี้ล่าสุดเพื่อแสดงตัวเลขเร็ว",
        output: "Document | null",
      },
    ],
    data_shape: `Document {
  id: string
  document_type: string
  document_number: string
  status: string
  partner_id: string
  net_amount: number
  issue_date: string
  business_event_id: string | null
}`,
  },
  {
    id: "debt-dashboard",
    name: "Debt Dashboard",
    name_th: "แดชบอร์ดหนี้",
    category: "Finance",
    description: "สรุปหนี้ค้างชำระและรายการติดตาม",
    commands: [
      {
        command: "debt.list",
        purpose: "หนี้ที่ยังค้างชำระ (OPEN)",
        output: "InvoiceDebt[]",
      },
      {
        command: "debt.trackings",
        purpose: "รายการติดตามลูกหนี้ (debt_trackings table)",
        output: "DebtTracking[]",
      },
      {
        command: "debt.all",
        purpose: "หนี้ทุกสถานะ (ใช้เมื่อต้องการดูประวัติ)",
        output: "InvoiceDebt[]",
      },
    ],
    data_shape: `InvoiceDebt {
  id: string
  document_id: string
  invoice_status: "OPEN" | "PARTIAL" | "PAID" | "OVERDUE"
  outstanding_amount: number
  paid_amount: number
}`,
  },
  {
    id: "document-flow",
    name: "Document Flow",
    name_th: "ประวัติเอกสารทั้งหมด",
    category: "Documents",
    description: "เอกสารทุกประเภทในระบบ — ใช้เป็น audit trail",
    commands: [
      {
        command: "document.list",
        purpose: "เอกสารทุกชิ้นทุกประเภท",
        output: "Document[]",
      },
      {
        command: "document.boq",
        purpose: "เฉพาะ BOQ",
        output: "Document[]",
      },
      {
        command: "document.po",
        purpose: "เฉพาะ Purchase Order",
        output: "Document[]",
      },
      {
        command: "document.do",
        purpose: "เฉพาะ Delivery Order",
        output: "Document[]",
      },
      {
        command: "document.receipt",
        purpose: "เฉพาะใบเสร็จ",
        output: "Document[]",
      },
    ],
    data_shape: `Document {
  id, document_type, document_number,
  status, partner_id, net_amount, issue_date
}`,
  },
  {
    id: "draft-approval",
    name: "Draft Approval",
    name_th: "อนุมัติร่างจาก LINE",
    category: "AI Workflow",
    description: "หน้าตรวจสอบและอนุมัติร่างเอกสารที่ AI วิเคราะห์จาก LINE",
    commands: [
      {
        command: "draft.list",
        purpose: "ร่างเอกสารที่รอการอนุมัติ",
        output: "LineDraftDocument[]",
      },
    ],
    data_shape: `LineDraftDocument {
  id: string
  doc_type: string
  status: "pending" | "approved" | "rejected"
  payload: Record<string, unknown>
  created_at: string
}`,
    notes: "การอนุมัติ (approve) ต้องทำผ่าน /admin UI เท่านั้น — Rule 72 บล็อก external AI",
  },
  {
    id: "job-board",
    name: "Job Board",
    name_th: "กระดานงาน",
    category: "Operations",
    description: "ติดตามงานจัดส่งและโปรเจกต์",
    commands: [
      {
        command: "job.active",
        purpose: "งานที่กำลังดำเนินการ (IN_PROGRESS)",
        output: "Job[]",
      },
      {
        command: "job.list",
        purpose: "งานทั้งหมดทุกสถานะ",
        output: "Job[]",
      },
    ],
    data_shape: `Job {
  id: string
  partner_id: string
  job_status: "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED"
  distance_km: number | null
  required_quantity: number | null
}`,
  },
  {
    id: "material-catalog",
    name: "Material Catalog",
    name_th: "รายการวัสดุ",
    category: "Catalog",
    description: "รายการวัสดุ/สินค้าในระบบ — ใช้ใน dropdown ตอนสร้างเอกสาร",
    commands: [
      {
        command: "material.list",
        purpose: "วัสดุทุกประเภท",
        output: "MaterialType[]",
      },
    ],
    data_shape: `MaterialType {
  id: string
  name: string
}`,
  },
]

const CATEGORIES = Array.from(new Set(EXAMPLES.map(e => e.category)))

const CATEGORY_COLOR: Record<string, string> = {
  "Relationship": "bg-sky-100 text-sky-700",
  "Documents":    "bg-blue-100 text-blue-700",
  "Finance":      "bg-emerald-100 text-emerald-700",
  "AI Workflow":  "bg-violet-100 text-violet-700",
  "Operations":   "bg-amber-100 text-amber-700",
  "Catalog":      "bg-stone-100 text-stone-600",
}

export default function ExamplesPage() {
  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-800">
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-2">
          <Link href="/start" className="text-xs text-stone-400 hover:text-stone-600">← Developer Portal</Link>
        </div>
        <div className="mb-8">
          <h1 className="text-xl font-bold text-stone-900">Screen Examples</h1>
          <p className="text-xs text-stone-500 mt-1">
            แต่ละหน้าจอต้องใช้ command อะไรบ้าง — สำหรับ UI designer และ developer ที่เริ่มต้นสร้าง UI บน DNA OS
          </p>
        </div>

        {/* Category filter (visual only — static) */}
        <div className="flex flex-wrap gap-2 mb-8">
          {CATEGORIES.map(cat => (
            <span key={cat} className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${CATEGORY_COLOR[cat] ?? "bg-stone-100 text-stone-600"}`}>
              {cat}
            </span>
          ))}
        </div>

        {/* Examples */}
        <div className="space-y-6">
          {EXAMPLES.map((ex) => (
            <div key={ex.id} className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
              {/* Screen header */}
              <div className="px-6 py-4 border-b border-stone-100">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-bold text-stone-900">{ex.name}</h2>
                      <span className="text-stone-400 text-sm">/</span>
                      <span className="text-stone-600 text-sm">{ex.name_th}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CATEGORY_COLOR[ex.category] ?? "bg-stone-100 text-stone-600"}`}>
                        {ex.category}
                      </span>
                    </div>
                    <p className="text-xs text-stone-500 mt-1">{ex.description}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-stone-100">
                {/* Commands needed */}
                <div className="px-6 py-4">
                  <div className="text-[10px] font-semibold text-stone-400 uppercase mb-3">Commands Required</div>
                  <div className="space-y-3">
                    {ex.commands.map((cmd) => (
                      <div key={cmd.command} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-lg">
                            {cmd.command}
                          </code>
                        </div>
                        <div className="text-xs text-stone-500">{cmd.purpose}</div>
                        {cmd.args && (
                          <div className="text-[11px] font-mono text-stone-400 bg-stone-50 rounded px-2 py-1">
                            args: {cmd.args}
                          </div>
                        )}
                        <div className="text-[11px] text-stone-400">→ {cmd.output}</div>
                      </div>
                    ))}
                  </div>
                  {ex.notes && (
                    <div className="mt-3 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                      {ex.notes}
                    </div>
                  )}
                </div>

                {/* Data shape */}
                <div className="px-6 py-4">
                  <div className="text-[10px] font-semibold text-stone-400 uppercase mb-3">Data Shape</div>
                  <pre className="text-[11px] font-mono text-stone-700 bg-stone-50 rounded-xl px-4 py-3 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                    {ex.data_shape}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="mt-10 text-center text-xs text-stone-400 space-y-1">
          <div>ทดลองเรียก command จริง →{" "}
            <Link href="/playground" className="underline hover:text-stone-600">API Playground</Link>
          </div>
          <div>ดู spec ครบทุก command →{" "}
            <a href="/api/v1/spec" target="_blank" className="underline hover:text-stone-600">/api/v1/spec</a>
          </div>
        </div>
      </div>
    </div>
  )
}
