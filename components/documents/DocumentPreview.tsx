'use client'

import { useEffect, useMemo, useRef, useState } from "react"
import { type DocumentDraftInput, draftToDocData } from "@/engines/documents/document-editor"
import type { CompanySettings } from "@/core/config/company-settings"
import { generateDoc } from "@/engines/documents/engine"
import { A4_PAGE, a4ValuesFromDoc, fillA4Master, loadA4Master } from "@/engines/documents/a4-master"

interface Props {
  draft: DocumentDraftInput
  settings: CompanySettings | null
}

/**
 * Preview เอกสาร — แม่แบบเดียวของบริษัท: public/documents/dna-os-a4-master.html
 * (renderer: engines/documents/a4-master.ts)
 *
 * Render ผ่าน iframe เพราะแม่แบบมี CSS ของ body/html เป็นของตัวเอง
 *
 * LOCKED TO PAGE (owner, 2026-11-10): เดิม iframe กว้าง w-full สูง 1100px ทำให้
 * กระดาษ A4 (794px + margin) กว้างกว่ากรอบ → เกิด scroll แนวนอน เห็นเอกสารไม่ครบ
 * ตอนนี้ iframe ถูกตรึงที่ขนาดกระดาษจริงแล้วย่อด้วย transform: scale ให้พอดีกรอบ
 * เสมอ (ไม่มี scroll แนวนอน และเห็นทั้งหน้าในครั้งเดียว)
 */
export default function DocumentPreview({ draft, settings }: Props) {
  const frameWrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const [masterHtml, setMasterHtml] = useState<string | null>(null)
  const [masterError, setMasterError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadA4Master()
      .then((html) => { if (alive) setMasterHtml(html) })
      .catch((error: unknown) => { if (alive) setMasterError(error instanceof Error ? error.message : String(error)) })
    return () => { alive = false }
  }, [])

  const html = useMemo(() => {
    if (!masterHtml || !settings) return null
    const docNumber = draft.documentNumber?.trim() || "ร่าง"
    const data = draftToDocData(draft, docNumber, settings)
    if (data.items.length === 0 && !data.customer?.name) return null
    const doc = generateDoc(data)
    return fillA4Master(masterHtml, a4ValuesFromDoc(data, doc))
  }, [masterHtml, draft, settings])

  // ย่อให้พอดีความกว้างของกรอบจริง — วัดจาก container ไม่ใช่จากหน้าจอ
  useEffect(() => {
    const wrap = frameWrapRef.current
    if (!wrap) return
    const measure = () => {
      const width = wrap.clientWidth
      if (width > 0) setScale(Math.min(1, width / A4_PAGE.width))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [html])

  if (masterError) {
    return (
      <div className="flex items-center justify-center h-64 px-6 text-center text-sm text-rose-600 bg-rose-50 rounded-xl border border-rose-200">
        {masterError}
      </div>
    )
  }

  if (!html) {
    return (
      <div className="flex items-center justify-center h-64 text-stone-400 text-sm bg-white rounded-xl border border-stone-200">
        {settings ? "กรอกคู่ค้าหรือรายการอย่างน้อย 1 รายการเพื่อดูตัวอย่าง" : "กำลังโหลดข้อมูลบริษัท..."}
      </div>
    )
  }

  return (
    <div ref={frameWrapRef} className="w-full overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div style={{ height: Math.round(A4_PAGE.height * (scale || 0)) }} className="relative w-full">
        <iframe
          title="document-preview"
          srcDoc={html}
          scrolling="no"
          style={{
            width: A4_PAGE.width,
            height: A4_PAGE.height,
            border: 0,
            position: "absolute",
            top: 0,
            left: 0,
            transform: `scale(${scale || 0})`,
            transformOrigin: "top left",
          }}
        />
      </div>
    </div>
  )
}
