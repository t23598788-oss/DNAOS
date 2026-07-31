"use client"

import { useRouter } from "next/navigation"

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

  return (
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
    </div>
  )
}
