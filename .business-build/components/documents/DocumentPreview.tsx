'use client'

import { useMemo, useRef, useEffect } from "react"
import { type DocumentDraftInput, draftToDocData } from "@/engines/documents/document-editor"
import type { CompanySettings } from "@/core/config/company-settings"
import { generateDoc } from "@/engines/documents/engine"

interface Props {
  draft: DocumentDraftInput
  settings: CompanySettings | null
}

/**
 * Preview เอกสาร — ใช้ template เดียวกับ engine.ts/template.ts เสมอ (Single Template Policy)
 * Render ผ่าน iframe เพราะ template.ts ใช้ CSS แบบ unscoped (body, h1 ฯลฯ)
 */
export default function DocumentPreview({ draft, settings }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const html = useMemo(() => {
    if (!settings) return null
    const docNumber = draft.documentNumber?.trim() || "ร่าง"
    const data = draftToDocData(draft, docNumber, settings)
    if (data.items.length === 0 && !data.customer?.name) return null
    return generateDoc(data).html
  }, [draft, settings])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !html) return
    iframe.srcdoc = html
  }, [html])

  if (!html) {
    return (
      <div className="flex items-center justify-center h-64 text-stone-400 text-sm bg-white rounded-xl border border-stone-200">
        {settings ? "กรอกคู่ค้าหรือรายการอย่างน้อย 1 รายการเพื่อดูตัวอย่าง" : "กำลังโหลดข้อมูลบริษัท..."}
      </div>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      title="document-preview"
      className="w-full bg-white rounded-xl border border-stone-200 shadow-sm"
      style={{ height: "1100px" }}
    />
  )
}
