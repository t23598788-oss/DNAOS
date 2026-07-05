import DocumentBuilder from "@/components/documents/DocumentBuilder"

interface Props { searchParams: Promise<{ documentId?: string }> }

export default async function InvoicePage({ searchParams }: Props) {
  const { documentId } = await searchParams
  return <DocumentBuilder mode="browser" type="invoice" initialDocId={documentId} />
}
