"use client";

// UI Gallery — COMPARE (/admin/ui-gallery/compare?ids=a,b,c  |  ?preset=<presetId>)
//
// เปรียบเทียบ UI จริงพร้อมกัน 2–4 ตัว ด้วย <iframe> ของ route จริง (ไม่คัดลอก UI)
// พร้อมป้ายบอกว่า pane ใดใช้ shell/layout เดียวกัน — ช่วยให้เห็น reuse ได้ทันที
//
// ไม่มี logic เปรียบเทียบเชิงธุรกิจ: เทียบเฉพาะการนำเสนอ (shell / layout / ความกว้าง)

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { UI_COMPARE_PRESETS, getUiItems, shellSignature, type UiItem } from "../_lib/uiIndex";

const COL_OPTIONS = [2, 3, 4] as const;
const MAX_PANES = 4;

function CompareInner() {
  const router = useRouter();
  const params = useSearchParams();

  const presetId = params.get("preset");
  const preset = UI_COMPARE_PRESETS.find((p) => p.id === presetId);
  const idsParam = params.get("ids");

  const requestedIds = preset ? preset.itemIds : idsParam ? idsParam.split(",").filter(Boolean) : [];
  const requested = getUiItems(requestedIds);
  const panes = requested.filter((i) => i.renderMode === "route" && i.route).slice(0, MAX_PANES);
  const skipped = requested.filter((i) => !(i.renderMode === "route" && i.route));

  const [cols, setCols] = useState<number>(panes.length >= 3 ? 3 : 2);

  function removePane(id: string) {
    const next = panes.filter((p) => p.id !== id).map((p) => p.id);
    router.replace(`/admin/ui-gallery/compare?ids=${next.join(",")}`);
  }

  const signatures = panes.map((p) => shellSignature(p));
  const uniqueSignatures = Array.from(new Set(signatures));
  const allSameShell = panes.length > 1 && uniqueSignatures.length === 1;

  return (
    <div className="p-6">
      <Link href="/admin/ui-gallery" className="text-[11px] text-stone-500 underline">
        ← กลับไป UI Gallery
      </Link>
      <h1 className="mt-1 text-xl font-bold text-stone-900">เปรียบเทียบ UI</h1>
      <p className="mt-1 text-xs text-stone-500">
        เปิด UI จริงพร้อมกันสูงสุด {MAX_PANES} ตัว ด้วย iframe ของ route เดิม (same-origin, session เดิม)
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-stone-500">Preset:</span>
        {UI_COMPARE_PRESETS.map((p) => (
          <Link
            key={p.id}
            href={`/admin/ui-gallery/compare?preset=${p.id}`}
            title={p.reason}
            className={
              "rounded-full border px-2.5 py-1 " +
              (presetId === p.id
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-200 bg-white text-stone-600 hover:border-stone-400")
            }
          >
            {p.label}
          </Link>
        ))}
      </div>

      {preset && (
        <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-[11px] text-stone-600">
          <span className="font-medium text-stone-700">เหตุผลของ preset:</span> {preset.reason}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-stone-600">แสดง {panes.length} UI</span>
        <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5">
          {COL_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCols(c)}
              className={
                "text-[11px] rounded-md px-3 py-1 transition-colors " +
                (cols === c ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100")
              }
            >
              {c} คอลัมน์
            </button>
          ))}
        </div>
        {panes.length > 1 && (
          <span
            className={
              "rounded-full border px-2.5 py-1 text-[11px] " +
              (allSameShell
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700")
            }
          >
            {allSameShell
              ? `ใช้ shell/layout เดียวกันทั้งหมด: ${uniqueSignatures[0]}`
              : `shell/layout ต่างกัน ${uniqueSignatures.length} แบบ`}
          </span>
        )}
      </div>

      {panes.length === 0 && (
        <p className="mt-6 text-xs text-amber-700">
          ยังไม่ได้เลือก UI ที่มี route จริง — เลือกจาก{" "}
          <Link className="underline" href="/admin/ui-gallery">UI Gallery</Link> หรือกด preset ด้านบน
        </p>
      )}

      <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {panes.map((item) => (
          <ComparePane key={item.id} item={item} onRemove={() => removePane(item.id)} />
        ))}
      </div>
    </div>
  );
}

function ComparePane({ item, onRemove }: { item: UiItem; onRemove: () => void }) {
  return (
    <div className="rounded-xl border border-stone-200 overflow-hidden bg-white flex flex-col">
      <div className="border-b border-stone-100 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-stone-800 truncate">{item.label}</div>
            <div className="font-mono text-[10px] text-stone-400 truncate">{item.route}</div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            title="เอา pane นี้ออก"
            className="text-[11px] text-stone-400 hover:text-stone-700"
          >
            ✕
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-stone-500">{item.category}</span>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">
            {shellSignature(item)}
          </span>
          {item.branch === "branch" && (
            <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-purple-700">branch-only</span>
          )}
        </div>
      </div>
      <iframe
        src={item.route}
        title={`compare ${item.route}`}
        className="border-0 bg-white w-full"
        style={{ height: "calc(100vh - 22rem)", minHeight: 420 }}
      />
    </div>
  );
}

export default function UiGalleryComparePage() {
  return (
    <Suspense fallback={<div className="p-6 text-xs text-stone-400">กำลังโหลด compare…</div>}>
      <CompareInner />
    </Suspense>
  );
}

