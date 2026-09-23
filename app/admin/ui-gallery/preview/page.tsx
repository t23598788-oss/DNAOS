"use client";

// UI Gallery — PREVIEW (/admin/ui-gallery/preview?id=<itemId>)
//
// เปิด UI จริง 1 ตัว:
//   - renderMode=route     → <iframe src={route}> แสดง route จริงพร้อม shell/layout จริง
//                            (same-origin จึงใช้ session/cookie เดิม — ไม่มี auth ใหม่)
//   - renderMode=component → import component จริงผ่าน _lib/componentHost (ไม่มีสำเนา)
//   - renderMode=blocked   → การ์ดอธิบายเหตุผล + ลิงก์ไป route จริง (ไม่เปิด iframe เปล่า)
//
// ไม่มีการแก้ไข/คัดลอก UI ต้นทางในหน้านี้เลย

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getUiItem, uiBadges } from "../_lib/uiIndex";
import { hasHost, renderHost } from "../_lib/componentHost";

const DEVICE_WIDTHS = [
  { label: "เต็มพื้นที่", value: 0 },
  { label: "1280", value: 1280 },
  { label: "768", value: 768 },
] as const;

function PreviewInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const item = getUiItem(id);
  const [width, setWidth] = useState<number>(0);

  if (!item) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-bold text-stone-900">ไม่พบ UI ที่ระบุ</h1>
        <p className="mt-1 text-xs text-stone-500">
          id &quot;{id}&quot; ไม่มีในคลัง —{" "}
          <Link className="underline" href="/admin/ui-gallery">กลับไปที่ UI Gallery</Link>
        </p>
      </div>
    );
  }

  const hostOk = item.renderMode === "component" ? hasHost(item.hostKey) : true;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/ui-gallery" className="text-[11px] text-stone-500 underline">
            ← กลับไป UI Gallery
          </Link>
          <h1 className="mt-1 text-lg font-bold text-stone-900">{item.label}</h1>
          <div className="mt-1 font-mono text-[10px] text-stone-400 break-all">{item.path}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-stone-600">{item.category}</span>
            {uiBadges(item).map((b) => (
              <span key={b} className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-stone-600">{b}</span>
            ))}
          </div>
          {item.notes && <p className="mt-2 text-[11px] text-stone-500 max-w-3xl">{item.notes}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {item.renderMode === "route" && item.route && (
            <a
              href={item.route}
              target="_blank"
              rel="noreferrer"
              className="text-xs rounded-lg border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50"
            >
              เปิด route จริงในแท็บใหม่ ↗
            </a>
          )}
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(item.path); }}
            className="text-xs rounded-lg border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50"
          >
            คัดลอก path
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5">
            {DEVICE_WIDTHS.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => setWidth(d.value)}
                className={
                  "text-[11px] rounded-md px-2.5 py-1 transition-colors " +
                  (width === d.value ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100")
                }
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4">
        {item.renderMode === "route" && item.route ? (
          <div className="rounded-xl border border-stone-200 overflow-hidden bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-3 py-2">
              <span className="font-mono text-[11px] text-stone-500">iframe → {item.route}</span>
              <span className="text-[10px] text-stone-400">
                UI จริงจาก route เดิม · same-origin · ใช้ session เดิม (ไม่มี auth ใหม่)
              </span>
            </div>
            <div className="overflow-auto bg-white" style={{ height: "calc(100vh - 15rem)" }}>
              <iframe
                key={`${item.route}-${width}`}
                src={item.route}
                title={`preview ${item.route}`}
                className="border-0 bg-white"
                style={{ width: width === 0 ? "100%" : width, height: "100%", minHeight: "100%" }}
              />
            </div>
          </div>
        ) : item.renderMode === "component" && hostOk ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-stone-400">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                component จริง
              </span>
              <span>
                import จาก {item.path} — โฮสต์ป้อน props ว่าง/EMPTY_RENDER_MODEL เท่านั้น (ไม่มีข้อมูลธุรกิจตัวอย่าง)
              </span>
            </div>
            <div style={{ width: width === 0 ? "100%" : width }}>{renderHost(item.hostKey, {})}</div>
          </div>
        ) : (
          <BlockedCard
            title={item.renderMode === "component" ? "ยังไม่มีโฮสต์สำหรับ component นี้" : "UI นี้ preview ตรง ๆ ไม่ได้"}
            reason={
              item.renderMode === "component"
                ? `hostKey "${item.hostKey ?? "-"}" ไม่อยู่ใน _lib/componentHost.tsx (HOST_KEYS)`
                : item.blockedReason ?? "ไม่มีเหตุผลระบุ"
            }
            route={item.route}
          />
        )}
      </div>
    </div>
  );
}

function BlockedCard({ title, reason, route }: { title: string; reason: string; route?: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div className="text-sm font-semibold text-amber-800">{title}</div>
      <p className="mt-2 text-xs text-amber-800">{reason}</p>
      {route && (
        <a
          href={route}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-amber-800 hover:bg-amber-100"
        >
          เปิด route จริง: <span className="font-mono">{route}</span> ↗
        </a>
      )}
    </div>
  );
}

export default function UiGalleryPreviewPage() {
  return (
    <Suspense fallback={<div className="p-6 text-xs text-stone-400">กำลังโหลด preview…</div>}>
      <PreviewInner />
    </Suspense>
  );
}
