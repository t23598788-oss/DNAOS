"use client";

// UIKit — ChatPanel
// แผงแชท (ใช้ได้ทั้ง LINE thread และ cognitive pipeline / แชทเลขา) — รับ messages + onSend ผ่าน props
// ไม่ผูกกับ LINE หรือ AI backend ตัวใดตัวหนึ่งตรง ๆ — การเชื่อมจริงทำที่ชั้น services/plugins แล้ว pipe เข้ามาที่นี่

import { useState } from "react";
import Window from "./Window";
import EmptyState from "./EmptyState";
import { MessageSquare, Send } from "lucide-react";

export interface ChatMessage {
  id: string;
  author: string;
  text: string;
  timestamp: string;
  self?: boolean;
}

export default function ChatPanel({
  title = "Chat",
  messages,
  onSend,
  onClose,
  variant = "window",
}: {
  title?: string;
  messages: ChatMessage[];
  onSend?: (text: string) => void;
  onClose: () => void;
  variant?: "window" | "panel";
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend?.(text);
    setDraft("");
  }

  return (
    <Window
      title={title}
      icon={<MessageSquare className="w-4 h-4 text-stone-400" />}
      onClose={onClose}
      className={variant === "panel" ? "" : "h-[520px]"}
      variant={variant}
    >
      <div className="flex flex-col h-full bg-[#e5ece5]">
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {messages.length === 0 ? (
            <EmptyState message="ยังไม่มีข้อความ" />
          ) : (
            messages.map((m) => (
              <div key={m.id} className={"flex " + (m.self ? "justify-end" : "justify-start")}>
                <div
                  className={
                    "max-w-[75%] rounded-lg px-3 py-2 shadow-sm " +
                    (m.self ? "bg-[#a8e2a0]" : "bg-white border border-stone-200")
                  }
                >
                  {!m.self && <p className="text-[10px] text-stone-400 mb-0.5">{m.author}</p>}
                  <p className="text-xs text-stone-800 whitespace-pre-line">{m.text}</p>
                  <p className="text-[9px] text-stone-500 mt-1 text-right">{m.timestamp}</p>
                </div>
              </div>
            ))
          )}
        </div>
        {onSend && (
          <div className="flex items-center gap-2 p-2.5 border-t border-stone-200 bg-white flex-shrink-0">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="พิมพ์ข้อความ..."
              className="flex-1 bg-stone-50 border border-stone-200 rounded-md px-3 py-1.5 text-xs text-stone-800 placeholder-stone-400 outline-none focus:border-emerald-500"
            />
            <button
              onClick={submit}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </Window>
  );
}
