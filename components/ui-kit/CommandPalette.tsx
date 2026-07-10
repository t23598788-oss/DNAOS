"use client";

// UIKit — CommandPalette
// Cmd+K launcher — ทางเข้าเดียวที่ทั้งมนุษย์และ AI (cognitive pipeline) ใช้ "Open Panel: X" / "Hide Panel: X"
// รายการคำสั่งมาจาก props.commands เท่านั้น ไม่ hardcode ชื่อโมดูลธุรกิจในไฟล์นี้
// เชื่อมกับ cognitive pipeline จริงทำได้โดยส่ง onRun ที่ยิงไปที่ app/api/chat แล้วแปลผลลัพธ์กลับมาเป็น open()/closeByKey()

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useWorkspace, type ComponentKey } from "./WorkspaceCanvas";

export interface PaletteCommand {
  id: string;
  label: string;
  keywords?: string[];
  targetKey: ComponentKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetProps?: Record<string, any>;
}

export default function CommandPalette({
  commands,
  hotkey = "k",
}: {
  commands: PaletteCommand[];
  hotkey?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { open } = useWorkspace();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === hotkey) {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
      if (e.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.keywords ?? []).some((k) => k.toLowerCase().includes(q))
    );
  }, [commands, query]);

  if (!isOpen) return null;

  function run(cmd: PaletteCommand) {
    open(cmd.targetKey, cmd.targetProps);
    setIsOpen(false);
    setQuery("");
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center pt-28 bg-black/60 backdrop-blur-sm"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-[560px] max-w-[90vw] bg-white border border-stone-200 rounded-xl shadow-2xl overflow-hidden animate-[fadeIn_0.15s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-stone-100">
          <Search className="w-4 h-4 text-stone-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="พิมพ์คำสั่ง หรือชื่อสิ่งที่ต้องการเปิด..."
            className="flex-1 bg-transparent text-sm text-stone-800 placeholder-stone-400 outline-none"
          />
          <span className="text-[10px] text-stone-400 border border-stone-200 rounded px-1.5 py-0.5">esc</span>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="text-xs text-stone-400 text-center py-6">ไม่พบคำสั่งที่ตรงกัน</p>
          )}
          {filtered.map((cmd) => (
            <button
              key={cmd.id}
              onClick={() => run(cmd)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition-colors"
            >
              {cmd.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
