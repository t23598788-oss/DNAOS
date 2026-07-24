import { supabaseAdmin } from "@/services/supabase/queries"
import { createDocumentArtifacts } from "@/engines/documents/artifact"
import type { DocData } from "@/engines/documents/engine"

const BUCKET = "attachments"
const URL_TTL_SECONDS = 7 * 24 * 60 * 60

export interface StoredDocumentArtifacts {
  imageUrl: string
  pdfUrl: string
  imagePath: string
  pdfPath: string
}

/** Store the same canonical document as PDF + LINE-expandable image. */
export async function storeDocumentArtifacts(documentId: string, data: DocData): Promise<StoredDocumentArtifacts> {
  const artifacts = await createDocumentArtifacts(data)
  const prefix = `generated-documents/${documentId}/${Date.now()}`
  const imagePath = `${prefix}/${artifacts.fileName.replace(/\.pdf$/i, ".png")}`
  const pdfPath = `${prefix}/${artifacts.fileName}`
  const storage = supabaseAdmin().storage.from(BUCKET)

  const [imageUpload, pdfUpload] = await Promise.all([
    storage.upload(imagePath, artifacts.image, { contentType: "image/png", upsert: false }),
    storage.upload(pdfPath, artifacts.pdf, { contentType: "application/pdf", upsert: false }),
  ])
  if (imageUpload.error) throw new Error(`บันทึกภาพเอกสารไม่สำเร็จ: ${imageUpload.error.message}`)
  if (pdfUpload.error) throw new Error(`บันทึก PDF ไม่สำเร็จ: ${pdfUpload.error.message}`)

  const [imageSigned, pdfSigned] = await Promise.all([
    storage.createSignedUrl(imagePath, URL_TTL_SECONDS),
    storage.createSignedUrl(pdfPath, URL_TTL_SECONDS),
  ])
  if (imageSigned.error || !imageSigned.data?.signedUrl) throw new Error(`สร้างลิงก์ภาพเอกสารไม่สำเร็จ: ${imageSigned.error?.message ?? "ไม่มี URL"}`)
  if (pdfSigned.error || !pdfSigned.data?.signedUrl) throw new Error(`สร้างลิงก์ PDF ไม่สำเร็จ: ${pdfSigned.error?.message ?? "ไม่มี URL"}`)

  return { imageUrl: imageSigned.data.signedUrl, pdfUrl: pdfSigned.data.signedUrl, imagePath, pdfPath }
}

export function lineDocumentMessages(artifacts: StoredDocumentArtifacts, altText: string) {
  return [
    { type: "image" as const, originalContentUrl: artifacts.imageUrl, previewImageUrl: artifacts.imageUrl },
    { type: "text" as const, text: `${altText}\nเปิดเอกสาร PDF: ${artifacts.pdfUrl}` },
  ]
}
