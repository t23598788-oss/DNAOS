import DocumentBuilder from "@/components/documents/DocumentBuilder"

interface Props { searchParams: Promise<{ documentId?: string }> }

export default async function PaymentVoucherPage({ searchParams }: Props) {
  const { documentId } = await searchParams
  return <DocumentBuilder mode="browser" type="payment_voucher" initialDocId={documentId} />
}
