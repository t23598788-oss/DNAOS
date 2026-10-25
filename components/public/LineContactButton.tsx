/**
 * LINE OA contact button (2026-10-24 public entry pass).
 *
 * Source of truth: NEXT_PUBLIC_LINE_OA_URL — the ONE place the public site may
 * learn the Official Account link. Verified state of this repository: there is
 * NO LINE OA add-friend URL / basic ID stored anywhere yet (checked: whole-repo
 * grep for line.me / lin.ee returns only server API endpoints api.line.me — the
 * messaging credential path, not an OA public link). Therefore this component
 * renders the configured link when the env exists and an HONEST "not available"
 * notice when it does not — it never fabricates `@dna-os` or similar.
 *
 * Product reference forwarding: LINE only accepts a prefilled message on the
 * `line.me/R/oaMessage/<id>/?text=` form (documented LINE behaviour). We append
 * `text` ONLY when the configured URL is already an oaMessage link; on a plain
 * add-friend URL we send the visitor to the OA and show the reference on-page
 * instead of inventing a parameter the platform ignores.
 *
 * The claim "รับข้อความอัตโนมัติ 24 ชั่วโมง" is intentionally absent: the
 * auto-reply path has not been live-verified (LINE_CHANNEL_ACCESS_TOKEN /
 * LINE_CHANNEL_SECRET are not configured), so an always-on promise would be
 * false advertising.
 */
import Link from "next/link"

export interface LineContactButtonProps {
  /** published reference (e.g. catalog slug) forwarded into the LINE message */
  reference?: string
  variant?: "primary" | "inline"
  className?: string
}

const CTA_TEXT = "ติดต่อ สอบถามราคา และส่งคำขอจองผ่าน LINE"

function lineOaUrl(reference?: string): string | null {
  const raw = process.env.NEXT_PUBLIC_LINE_OA_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!/(^|\.)line\.me$/i.test(url.hostname)) return null
    // only LINE's documented prefill form accepts text
    if (reference && /\/oaMessage\//i.test(url.pathname)) {
      url.searchParams.set("text", `สนใจรายการ: ${reference}`)
    }
    return url.toString()
  } catch {
    return null
  }
}

export default function LineContactButton({ reference, variant = "primary", className = "" }: LineContactButtonProps) {
  const href = lineOaUrl(reference)

  if (!href) {
    return (
      <div
        className={`rounded-xl border border-[#E9E1D6] bg-[#F7F4EF] px-4 py-3 text-sm text-stone-600 ${className}`}
        data-line-status="not_configured"
      >
        <div className="font-semibold text-stone-800">ช่องทาง LINE ยังไม่เปิดใช้งาน</div>
        <p className="mt-1 text-xs text-stone-500">
          ระบบยังไม่ได้ตั้งค่าบัญชี LINE Official Account สาธารณะ — ระหว่างนี้ใช้{" "}
          <Link href="/register" className="text-[#1e6fa8] hover:underline">
            สมัครสมาชิก
          </Link>{" "}
          หรือ{" "}
          <Link href="/login" className="text-[#1e6fa8] hover:underline">
            เข้าสู่ระบบ
          </Link>{" "}
          เพื่อติดต่อทีมงาน
        </p>
      </div>
    )
  }

  const base =
    variant === "primary"
      ? "inline-flex items-center justify-center gap-2 rounded-xl bg-[#06C755] px-5 py-3 text-sm font-semibold text-black hover:brightness-105 transition"
      : "inline-flex items-center gap-2 text-sm text-[#06C755] hover:underline"

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} ${className}`}
      data-line-status="configured"
    >
      {/* Official LINE glyph, drawn inline — no external asset/CDN dependency */}
      <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="currentColor">
        <path d="M12 3C6.98 3 3 6.3 3 10.36c0 3.6 3.05 6.6 7.17 7.17.28.06.66.18.76.42.09.21.06.55.03.77l-.13.78c-.04.24-.19.94.86.51 1.05-.43 5.66-3.34 7.72-5.71C20.5 12.96 21 11.74 21 10.36 21 6.3 17.02 3 12 3Z" />
      </svg>
      {CTA_TEXT}
    </a>
  )
}
