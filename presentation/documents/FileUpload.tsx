"use client"

import { useRef, useState } from "react"
import { Paperclip, X, Loader2, Download } from "lucide-react"

export interface UploadedFile {
  path: string
  name: string
  size: number
  type: string
}

/**
 * Reusable file-attachment widget — uploads through /api/admin/upload (the one
 * real Storage door), lists what's attached, and opens a short-lived signed URL
 * to view/download. No business-specific logic here; documentId is just a folder key.
 */
export default function FileUpload({
  documentId,
  files,
  onChange,
}: {
  documentId: string
  files: UploadedFile[]
  onChange: (files: UploadedFile[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const uploaded: UploadedFile[] = []
      for (const file of Array.from(fileList)) {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("documentId", documentId)
        const res = await fetch("/api/admin/upload", { method: "POST", body: formData })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `อัปโหลด ${file.name} ไม่สำเร็จ`)
        uploaded.push(json)
      }
      onChange([...files, ...uploaded])
    } catch (e) {
      setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const openFile = async (path: string) => {
    const res = await fetch(`/api/admin/upload?path=${encodeURIComponent(path)}`)
    const json = await res.json()
    if (res.ok && json.url) window.open(json.url, "_blank", "noopener,noreferrer")
    else setError(json.error ?? "เปิดไฟล์ไม่สำเร็จ")
  }

  const removeFile = async (path: string) => {
    const res = await fetch(`/api/admin/upload?path=${encodeURIComponent(path)}`, { method: "DELETE" })
    const json = await res.json()
    if (res.ok) onChange(files.filter((f) => f.path !== path))
    else setError(json.error ?? "ลบไฟล์ไม่สำเร็จ")
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-600 transition disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
          {uploading ? "กำลังอัปโหลด..." : "แนบไฟล์"}
        </button>
        <span className="text-[11px] text-stone-400">PDF/JPG/PNG/HEIC สูงสุด 20MB</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-2 text-xs bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5">
              <Paperclip className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <button type="button" onClick={() => openFile(f.path)} className="flex-1 text-left truncate text-stone-700 hover:text-blue-600 hover:underline">
                {f.name}
              </button>
              <span className="text-stone-400 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => openFile(f.path)} className="text-stone-400 hover:text-blue-600 shrink-0" aria-label={`ดาวน์โหลด ${f.name}`}>
                <Download className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => removeFile(f.path)} className="text-stone-400 hover:text-red-600 shrink-0" aria-label={`ลบ ${f.name}`}>
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
