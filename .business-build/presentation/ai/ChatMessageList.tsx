// เรนเดอร์รายการข้อความบทสนทนาของ playground จาก ChatMessage (presentation เท่านั้น)
import type { ChatMessage } from "@/app/playground/_lib/conversationState"
import { ResultCard } from "./ResultCard"
import { ClarifyingChoice } from "./ClarifyingChoice"
import { ConfirmationPreview } from "./ConfirmationPreview"

export interface ClarifyMeta {
  adminUrl?: string
  adminLabel?: string
  commandLabel?: string
}

export function ChatMessageList({
  messages, activeClarifyId, onChoose, running,
}: {
  messages: ChatMessage[]
  activeClarifyId: string | null
  onChoose: (index: number) => void
  running: boolean
}) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-600 text-xs">
        พิมพ์ข้อความเพื่อเริ่มต้น เช่น &quot;ดูหนี้ค้าง&quot;
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto space-y-3 pr-1">
      {messages.map(m => (
        <div key={m.id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
          {m.sender === "user" && (
            <div className="bg-sky-500/20 border border-sky-700/50 rounded-2xl px-4 py-2 max-w-[85%] text-sm text-stone-100">
              {m.text}
            </div>
          )}

          {m.sender === "system" && m.kind === "text" && (
            <div className="bg-stone-800 border border-stone-700 rounded-2xl px-4 py-2 max-w-[85%] text-sm text-stone-300">
              {m.text}
            </div>
          )}

          {m.sender === "system" && m.kind === "error" && (
            <div className="bg-rose-900/30 border border-rose-800 rounded-2xl px-4 py-2 max-w-[85%] text-sm text-rose-300">
              {m.text}
            </div>
          )}

          {m.sender === "system" && m.kind === "result" && (
            <ResultCard label="ผลลัพธ์" text={m.text} />
          )}

          {m.sender === "system" && m.kind === "clarify" && (
            <ClarifyingChoice
              prompt={m.text}
              options={m.options ?? []}
              active={m.id === activeClarifyId && !running}
              onChoose={onChoose}
            />
          )}

          {m.sender === "system" && m.kind === "write-preview" && (
            <WritePreviewFromText text={m.text} />
          )}
        </div>
      ))}
    </div>
  )
}

// write-preview messages encode "label|||adminUrl|||adminLabel" in text —
// kept simple rather than widening ChatMessage's shape for one variant.
function WritePreviewFromText({ text }: { text: string }) {
  const [commandLabel, adminUrl, adminLabel] = text.split("|||")
  return <ConfirmationPreview commandLabel={commandLabel} adminUrl={adminUrl} adminLabel={adminLabel} />
}
