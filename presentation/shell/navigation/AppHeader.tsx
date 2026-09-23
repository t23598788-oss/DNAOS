'use client'

import type { ReactNode } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Home, ArrowLeft } from "lucide-react"

const HOME_PATH = "/admin/relationships"

export interface AppHeaderProps {
  /** Module name — owned by the module, not by Navigation (e.g. "ข้อความ", "การเงิน", "ใบแจ้งหนี้"). */
  title: string
  /** Module-specific buttons/content — owned by the module (e.g. selected contact info, send button). */
  actions?: ReactNode
  className?: string
}

// Navigation redesign (owner, 2026-07-16) — third and final iteration.
// v1 was a floating overlay (covered real content). v2 was Home/Back
// hand-copied into one page's header (correct instinct, wrong unit — every
// other page would need the same copy-paste). This is the real fix: ONE
// shared header component every /admin/* page renders, standard order
// fixed here (Back | Home | title | actions), so Navigation stays the
// system's responsibility and title/actions stay each module's — neither
// side can drift from the other by construction, not by convention.
export default function AppHeader({ title, actions, className }: AppHeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const isHome = pathname === HOME_PATH

  return (
    <div className={"flex items-center gap-3 px-4 py-3 border-b border-stone-200 flex-shrink-0 bg-white " + (className ?? "")}>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => router.back()}
          title="ย้อนกลับ"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          onClick={() => router.push(HOME_PATH)}
          title="กลับหน้าหลัก"
          disabled={isHome}
          className={
            "w-7 h-7 flex items-center justify-center rounded-lg transition " +
            (isHome ? "text-emerald-600 bg-emerald-50 cursor-default" : "text-stone-500 hover:bg-stone-100 hover:text-stone-800")
          }
        >
          <Home size={15} />
        </button>
      </div>

      <span className="text-sm font-semibold text-stone-800 flex-shrink-0">{title}</span>

      <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
        {actions}
      </div>
    </div>
  )
}
