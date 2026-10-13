import { notFound } from "next/navigation"
import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"
import { findSection, PITS_TYPE_CODES } from "../_lib/sections"
import PitsByTypeView from "../_lib/PitsByTypeView"
import EquipmentPage from "@/app/admin/equipment/page"
import CreateDocumentPage from "@/app/admin/create-document/page"
import DocumentsPage from "@/app/admin/documents/page"
import FinancePage from "@/app/admin/finance/page"
import PartnersPage from "@/app/admin/partners/page"
import RelationshipsPage from "@/app/admin/relationships/page"
import LineCustomersPage from "@/app/admin/line-customers/page"
import LineProfilesPage from "@/app/admin/line-profiles/page"
import DebtTrackingPage from "@/app/admin/debt-tracking/page"
import ReceiptsPage from "@/app/admin/receipts/page"
import ReceiptPage from "@/app/admin/receipt/page"
import TransactionsPage from "@/app/admin/transactions/page"

/**
 * /biz/[section] — Business Workspace ใหม่ (หน้าจอเดียว สลับเนื้อหาตามแถบนำทางบน)
 *
 * หลักการย้าย: ใช้ component/API/สิทธิ์ "ของเดิม" ทั้งหมด — ไม่มี business logic ใหม่
 *  - 4 section ของ pits (โรงโม่หิน/บ่อทราย/บ่อดิน/โรงงาน) → ตารางกลาง BizTable + API /api/admin/pits เดิม
 *  - section อื่น → host component เดิมโดยตรง (capability ครบ 100% ไม่ต้องเขียนใหม่)
 * หน้าจอเดิม (/admin/*) ยังอยู่ครบ ไม่ถูกลบ — ดูหลักฐานท้ายรายงาน
 */
type Params = { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function BizSectionPage({ params, searchParams }: Params) {
  await requireAuthPage("/biz", ADMIN_TIER)

  const { section } = await params
  const found = findSection(section)
  if (!found) notFound()

  switch (found.key) {
    case "quarry":
    case "sand":
    case "soil":
    case "factory":
      return <PitsByTypeView typeCodes={PITS_TYPE_CODES[found.key]} title={found.label} />
    case "resources":
      return <EquipmentPage />
    case "create-document": {
      const sp = await searchParams
      return <CreateDocumentPage searchParams={Promise.resolve(sp as Record<string, string>)} />
    }
    case "documents":
      return <DocumentsPage />
    case "finance":
      return <FinancePage />
    // ——— รอบ 2: ความสามารถที่ค้าง — host หน้าจอเดิมทั้งใบ (action + สิทธิ์เดิมทุกบรรทัด) ———
    case "partners":
      return <PartnersPage />
    case "relationships":
      return <RelationshipsPage />
    case "line-customers":
      return <LineCustomersPage />
    case "line-profiles":
      return <LineProfilesPage />
    case "debt-tracking":
      return <DebtTrackingPage />
    case "receipts":
      return <ReceiptsPage />
    case "receipt": {
      const sp = await searchParams
      return <ReceiptPage searchParams={Promise.resolve({ documentId: typeof sp.documentId === "string" ? sp.documentId : undefined })} />
    }
    case "transactions":
      return <TransactionsPage />
    default:
      notFound()
  }
}
