import DocumentBuilder from "@/components/documents/DocumentBuilder"

interface Props { searchParams: Promise<{ documentId?: string }> }

export default async function ReceiptPage({ searchParams }: Props) {
  const { documentId } = await searchParams
  return <DocumentBuilder mode="browser" type="receipt" initialDocId={documentId} />
}
