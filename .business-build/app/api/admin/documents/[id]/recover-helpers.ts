import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Shared stored-file lookup (owner mission 2026-10-10) — single copy ใช้ร่วมกัน
// ระหว่าง artifact-recover route และ file route: อ่าน storage listing เฉย ๆ
// (behavior เทียบเท่าของเดิมใน artifact-recover ทุกประการ ไม่เขียนอะไรเลย)

export interface StoredFileSet {
  folder: string
  pngPath: string | null
  pdfPath: string | null
}

export async function findStoredFiles(documentId: string): Promise<StoredFileSet | null> {
  const storage = supabase().storage.from("attachments")
  const prefix = `generated-documents/${documentId}`
  const { data: entries, error } = await storage.list(prefix)
  if (error || !entries?.length) return null
  const sorted = [...entries].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  for (const entry of sorted) {
    const entryPath = `${prefix}/${entry.name}`
    const isFile = /\.(png|pdf)$/i.test(entry.name)
    const { data: files } = isFile ? { data: [entry] } : await storage.list(entryPath)
    const png = (files ?? []).find((f) => /\.png$/i.test(f.name))
    const pdf = (files ?? []).find((f) => /\.pdf$/i.test(f.name))
    if (png || pdf) {
      const dir = isFile ? prefix : entryPath
      return {
        folder: isFile ? "" : entry.name,
        pngPath: png ? `${dir}/${png.name}` : null,
        pdfPath: pdf ? `${dir}/${pdf.name}` : null,
      }
    }
  }
  return null
}
