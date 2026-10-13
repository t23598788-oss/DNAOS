"use client"

/**
 * BizNav — แถบนำทาง "แถวเดียว" ของ Business Workspace ใหม่
 * ไม่มี tab bar ซ้อนกัน: รายการเดียวสลับเนื้อหาในพื้นที่แสดงผลร่วมกันด้านล่าง
 * ไม่ดึงข้อมูลใด ๆ — เป็น presentation ล้วน สิทธิ์ยังอยู่ที่ server ของแต่ละ route
 */
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BIZ_SECTIONS } from "./sections"

export default function BizNav() {
  const pathname = usePathname()
  const active = pathname.split("/")[2] ?? BIZ_SECTIONS[0].key

  return (
    <nav className="dna-tool-access" aria-label="เมนูหลักธุรกิจ">
      <style>{`
        .dna-tool-access{position:relative;grid-row:1;align-self:stretch;padding:10px 16px;z-index:40;color:#36332f;font:14px/1.6 system-ui,sans-serif;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border-bottom:1px solid #e9e1d6}
        .dna-tool-title{font-weight:700;white-space:nowrap;margin-right:8px}
        .dna-tool-access a{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid #e9e1d6;border-radius:9px;background:#fdfbf8;color:inherit;text-decoration:none;font-size:13px;white-space:nowrap}
        .dna-tool-access a:hover{background:#f0ebe5}
        .dna-tool-access a[aria-current="page"]{background:#36332f;color:#fdfbf8;border-color:#36332f}
      `}</style>
      <span className="dna-tool-title">ธุรกิจ</span>
      {BIZ_SECTIONS.map((s) => (
        <Link key={s.key} href={`/biz/${s.key}`} aria-current={active === s.key ? "page" : undefined} title={s.description}>
          {s.label}
        </Link>
      ))}
    </nav>
  )
}
