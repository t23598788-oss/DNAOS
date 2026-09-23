// ช่องพิมพ์ข้อความของ playground + ชิปตัวอย่างคำสั่ง (presentation เท่านั้น ไม่เรียก API เอง)
import { useState } from "react"

const EXAMPLE_CHIPS = ["ดูหนี้ค้าง", "ดูลูกค้า", "ดูงานที่กำลังทำ", "ตรวจสถานะโปรแกรมบนเครื่อง"]

export function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("")

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
    setValue("")
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_CHIPS.map(example => (
          <button
            key={example}
            onClick={() => !disabled && onSend(example)}
            disabled={disabled}
            className="text-[11px] px-2.5 py-1 rounded-full border border-stone-700 text-stone-400 hover:border-sky-500 hover:text-sky-300 disabled:opacity-40 transition"
          >
            {example}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          disabled={disabled}
          placeholder="ต้องการให้ DNA OS ทำอะไร..."
          className="flex-1 bg-stone-900 border border-stone-600 rounded-xl px-3 py-2.5 text-sm text-stone-100 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="px-5 py-2.5 rounded-xl font-bold text-sm bg-sky-500 hover:bg-sky-400 text-white disabled:opacity-50 transition"
        >
          ส่ง
        </button>
      </div>
    </div>
  )
}
