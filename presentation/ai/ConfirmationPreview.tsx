import Link from "next/link"

/**
 * Shown for requires_confirmation:true intents. There is deliberately no
 * "confirm" button that calls anything — /api/v1/query mechanically cannot
 * execute a write command (the dispatcher's own Rule 72 gate), and this
 * component doesn't pretend otherwise. Its only action is a link to the
 * relevant /admin page.
 */
export function ConfirmationPreview({
  commandLabel, adminUrl, adminLabel,
}: { commandLabel: string; adminUrl: string; adminLabel: string }) {
  return (
    <div className="bg-stone-800 border border-rose-800/50 rounded-2xl px-4 py-3 max-w-[85%]">
      <div className="text-[10px] text-rose-400 uppercase font-semibold mb-1">ต้องยืนยันจากมนุษย์ (Rule 72)</div>
      <div className="text-sm text-stone-200 mb-2">
        &quot;{commandLabel}&quot; เป็นคำสั่งที่เปลี่ยนข้อมูลจริง ระบบนี้ดูข้อมูลได้อย่างเดียว
        ไม่สามารถสั่งงานนี้จากแชทได้ — ต้องไปยืนยันที่หน้าแอดมินเท่านั้น
      </div>
      <Link
        href={adminUrl}
        target="_blank"
        className="inline-block text-xs px-3 py-1.5 rounded-full border border-sky-600 text-sky-400 hover:bg-sky-900/30 transition"
      >
        ไปที่{adminLabel} ↗
      </Link>
    </div>
  )
}
