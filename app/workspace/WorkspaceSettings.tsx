"use client";

import { SETTINGS_BOXES } from "./_lib/toolBindings";

/** Navigation to existing guarded screens only; mounting does not run services. */
export function WorkspaceSettings({ onBack, columns }: { onBack: () => void; columns: 1 | 2 | 3 }) {
  return (
    <section className="min-h-0 flex-1 overflow-auto p-5">
      <button type="button" onClick={onBack} className="mb-4 rounded-lg border border-stone-300 px-3 py-2">← กลับพื้นที่ทำงาน</button>
      <h1 className="mb-4 text-lg font-medium">Settings</h1>
      <div className="rounded-xl border border-stone-300 p-5">
        <h2 className="mb-1 font-medium">DNA OS</h2>
        <p className="mb-5 text-xs text-stone-500">บริการภายใต้สิทธิ์ของระบบ · แต่ละบริการตรวจสิทธิ์ก่อนใช้งาน</p>
        <div className={`grid gap-3 ${columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
          {SETTINGS_BOXES.map(box => (
            <a key={box.key} href={box.route} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-stone-200 p-4 hover:bg-stone-50">
              <span className="block text-sm">{box.label}</span>
              <span className="mt-2 block text-xs text-stone-500">เปิดหน้าจัดการเดิมในแท็บใหม่ ↗</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
