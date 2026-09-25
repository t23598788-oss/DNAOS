"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import Link from "next/link"

// PLAYABLE BUSINESS LOOP (owner UX test, 2026-09-25) — wiring only: เมนูดึง
// ออกจากข้างจอภายใน HomeBackBar ตัวเดิม ทุกลิงก์ชี้หน้าที่มีอยู่แล้ว
// (ไม่มี route/feature/dashboard ใหม่ · ไม่แตะ auth/canonical/migration · ไม่มี mock)
const BUSINESS_MENU: { href: string; label: string }[] = [
  { href: "/admin/relationships", label: "ความสัมพันธ์ (หน้าหลัก)" },
  { href: "/workspace", label: "Workspace" },
  { href: "/admin/create-document", label: "สร้างเอกสารใหม่" },
  { href: "/admin/invoice", label: "ใบแจ้งหนี้" },
  { href: "/admin/receipt", label: "ใบเสร็จ (เอกสารขาย)" },
  { href: "/admin/purchase-order", label: "ใบสั่งซื้อ (PO)" },
  { href: "/admin/delivery-order", label: "ใบส่งของ (DO)" },
  { href: "/admin/payment-voucher", label: "ใบสำคัญจ่าย" },
  { href: "/admin/finance", label: "การเงิน" },
  { href: "/admin/debt-tracking", label: "ลูกหนี้ / หนี้ค้างชำระ" },
  { href: "/admin/receipts", label: "ใบเสร็จ/สลิป OCR" },
]

// Owner request (2026-07-30): once wrapped in a native Tauri window, there's
// no browser chrome at all — no back button, no address bar, nothing to
// navigate with except whatever the page itself provides.
//
// An earlier attempt at this (2026-07-16, see app/admin/layout.tsx's history)
// used a floating overlay and was reverted the same day because it covered
// real page content (e.g. the debt amount in this same relationships header).
// This bar is a normal, in-document-flow element instead — it takes up its
// own real space at the top of the page and pushes everything else down,
// so it can never sit on top of anything.
//
// 2026-07-30 addendum: some pages (e.g. app/admin/telemetry) render a
// `fixed inset-0` full-viewport child of their own (the 3D graph canvas) —
// a fixed element ignores document flow entirely and paints starting at the
// literal viewport top regardless of this bar's real flow position, so it
// was getting visually covered. Made this bar `sticky top-0` (still real
// flow space, still pushes content down) with a very high z-index so it
// always paints above such children, instead of forcing every full-bleed
// page to know about and leave room for this bar.
export function HomeBackBar() {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <div className="sticky top-0 z-[9999] flex items-center gap-2 bg-stone-900 px-3 py-1.5 text-xs text-stone-300">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-stone-700 hover:text-white transition"
        >
          ← ย้อนกลับ
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/relationships")}
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-stone-700 hover:text-white transition"
        >
          ⌂ หน้าหลัก
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          className="flex items-center gap-1 rounded px-2 py-1 font-semibold hover:bg-stone-700 hover:text-white transition"
        >
          ☰ เมนู
        </button>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-[10000]">
          <button
            type="button"
            aria-label="ปิดเมนู"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <nav className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-2xl p-4 overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-stone-800">เมนูระบบ</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100"
              >
                ปิด
              </button>
            </div>
            <div className="space-y-1">
              {BUSINESS_MENU.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                >
                  {m.label}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      )}
    </>
  )
}
