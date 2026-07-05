import DocumentBuilder from "@/components/documents/DocumentBuilder"
import { buildDebtNoticeDraft } from "@/lib/documents/debt-notice-draft"
import { buildDraftFromPartner, buildDraftFromDocument } from "@/lib/documents/draft-builders"

interface Props {
  searchParams: Promise<{
    fromDebtTracking?: string
    partnerId?: string       // เด้งมาจากหน้า partner / partner timeline
    type?: string            // กำหนด doc type ล่วงหน้า เช่น ?type=receipt
    fromDocId?: string       // คัดลอก partner/context จากเอกสารที่มีอยู่แล้ว
    transactionId?: string   // เชื่อม transaction ที่เปิดอยู่โดยตรง
  }>
}

export default async function CreateDocumentPage({ searchParams }: Props) {
  const { fromDebtTracking, partnerId, type, fromDocId, transactionId } = await searchParams

  // ลำดับ priority: fromDebtTracking → fromDocId → partnerId → default
  const initialDraft =
    fromDebtTracking    ? await buildDebtNoticeDraft(fromDebtTracking) :
    fromDocId           ? await buildDraftFromDocument(fromDocId, type) :
    partnerId           ? await buildDraftFromPartner(partnerId, type, transactionId) :
    undefined

  return <DocumentBuilder mode="create" initialDraft={initialDraft} />
}
