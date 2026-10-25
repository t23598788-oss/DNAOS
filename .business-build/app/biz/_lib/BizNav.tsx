"use client"

/**
 * BizNav — แถบนำทาง "แถวเดียว" ของ Business Workspace ใหม่
 * ไม่มี tab bar ซ้อนกัน: รายการเดียวสลับเนื้อหาในพื้นที่แสดงผลร่วมกันด้านล่าง
 * ไม่ดึงข้อมูลใด ๆ — เป็น presentation ล้วน สิทธิ์ยังอยู่ที่ server ของแต่ละ route
 *
 * STEP 3 (Document Save Integrity): เมื่ออยู่แท็บ "สร้างเอกสาร" จะแสดงเครื่องมือ
 * Print / Share / Save ที่ "ด้านขวาของ Top Bar เดิม" (เหนือ Preview) — เรียก action ที่
 * DocumentBuilder register ไว้ผ่าน DocumentActionsContext ไม่มี Toolbar ใหม่
 */
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useDocumentActions } from "@/components/documents/DocumentActionsContext"
import { BIZ_SECTIONS } from "./sections"

export default function BizNav() {
  const pathname = usePathname()
  const active = pathname.split("/")[2] ?? BIZ_SECTIONS[0].key
  const { actions } = useDocumentActions()
  const onCreateDoc = active === "create-document"
  const showDocTools = onCreateDoc && !!actions

  return (
    <nav className="dna-tool-access" aria-label="เมนูหลักธุรกิจ">
      <style>{`
        .dna-tool-access{position:relative;grid-row:1;align-self:stretch;padding:10px 16px;z-index:40;color:#36332f;font:14px/1.6 system-ui,sans-serif;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border-bottom:1px solid #e9e1d6}
        .dna-tool-title{font-weight:700;white-space:nowrap;margin-right:8px}
        .dna-tool-access a{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid #e9e1d6;border-radius:9px;background:#fdfbf8;color:inherit;text-decoration:none;font-size:13px;white-space:nowrap}
        .dna-tool-access a:hover{background:#f0ebe5}
        .dna-tool-access a[aria-current="page"]{background:#36332f;color:#fdfbf8;border-color:#36332f}
        .dna-doc-tool{padding:6px 12px;border:1px solid #d6cfc4;border-radius:8px;background:#fff;color:#36332f;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
        .dna-doc-tool:hover:not(:disabled){background:#f0ebe5}
        .dna-doc-tool:disabled{opacity:.4;cursor:not-allowed}
        .dna-doc-tool-primary{background:#36332f;color:#fdfbf8;border-color:#36332f}
        .dna-doc-tool-primary:hover:not(:disabled){background:#4a463f}
      `}</style>
      <span className="dna-tool-title">ธุรกิจ</span>
      {BIZ_SECTIONS.map((s) => (
        <Link key={s.key} href={`/biz/${s.key}`} aria-current={active === s.key ? "page" : undefined} title={s.description}>
          {s.label}
        </Link>
      ))}
      {showDocTools && (
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }} aria-label="เครื่องมือเอกสาร">
          <button
            type="button"
            onClick={actions!.print}
            disabled={!actions!.canPrint}
            className="dna-doc-tool"
            title="พิมพ์เอกสาร (แสดงเฉพาะเอกสาร)"
          >
            พิมพ์
          </button>
          <button
            type="button"
            onClick={actions!.share}
            disabled={!actions!.canShare}
            className="dna-doc-tool"
            title={actions!.shareHint ?? "แชร์/ส่งเอกสาร"}
          >
            แชร์
          </button>
          <button
            type="button"
            onClick={actions!.save}
            disabled={!actions!.canSave || actions!.saving}
            className="dna-doc-tool dna-doc-tool-primary"
            title="บันทึกเอกสาร (canonical writer)"
          >
            {actions!.saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </span>
      )}
    </nav>
  )
}
