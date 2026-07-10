"use client";

import { SYSTEM_LINKS } from "@/config/system-links";

export default function SystemLinksPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-4">
        <h1 className="text-base font-bold text-stone-800">ลิงก์ระบบ</h1>
        <p className="text-[11px] text-stone-400 mt-0.5">
          ลิงก์จริงของทุกระบบที่ใช้งานอยู่ — กดแล้วเข้าตรงหน้านั้นเลย ยังต้อง login ปกติของแต่ละเว็บด้วยอีเมลที่ระบุไว้
        </p>
      </div>

      <div className="p-6 space-y-4 max-w-4xl">
        {SYSTEM_LINKS.map((group) => (
          <div key={group.id} className="rounded-xl border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-stone-700">{group.title}</span>
              <span className="text-[10px] font-mono text-stone-400 bg-stone-100 px-2 py-0.5 rounded shrink-0">
                {group.account}
              </span>
            </div>
            <div className="divide-y divide-stone-50 max-h-80 overflow-y-auto">
              {group.items.map((item) => (
                <a
                  key={item.url}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-stone-600 hover:bg-stone-50 hover:text-violet-700 transition"
                >
                  <span className="truncate">{item.label}</span>
                  <span className="text-stone-300 shrink-0">↗</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
