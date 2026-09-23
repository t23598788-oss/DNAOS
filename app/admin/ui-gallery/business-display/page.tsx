"use client";

/**
 * BUSINESS DISPLAY — REVIEW (/admin/ui-gallery/business-display)
 *
 * แสดง (1) DISPLAY_PRIMITIVE_MAPPING และ (2) หน้าจอที่ render จาก display model จริง
 * ด้วย renderer ตัวเดียว — ให้ Owner เห็นว่าใช้หลักการแสดงผลแบบ work tool/IDE กับ
 * ข้อมูลธุรกิจได้ โดยไม่ต้องสร้าง component ใหม่ต่อรายการ
 *
 * ข้อมูลทั้งหมดเป็น "ตัวอย่างเชิงโครงสร้าง" · ไม่มี business logic · ไม่ผูก capability
 * · ไม่แตะ Canvas/Login/registry · palette เฉพาะที่ Owner อนุมัติ
 */
import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";
import {
  DISPLAY_PRIMITIVE_MAPPING,
  MAPPING_SUMMARY,
  SAMPLE_DISPLAY_MODELS,
  type MappingState,
} from "../_lib/businessDisplayModel";
import { BusinessDisplayRenderer } from "../_lib/BusinessDisplayRenderer";

const STATE_STYLE: Record<MappingState, string> = {
  REUSE_DIRECT: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ADAPT_ONLY: "border-amber-200 bg-amber-50 text-amber-700",
  MIXED: "border-rose-200 bg-rose-50 text-rose-700",
  MISSING: "border-stone-300 bg-stone-50 text-stone-500",
};

export default function BusinessDisplayReviewPage() {
  return (
    <div className="min-h-screen bg-[#F0EBE5] p-4 text-stone-800">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-wrap items-center gap-3">
          <ImageIcon className="h-5 w-5 text-stone-500" />
          <h1 className="text-lg font-bold">BUSINESS DISPLAY — หลักการแสดงผลแบบ work tool / IDE</h1>
          <Link href="/admin/ui-gallery" className="ml-auto text-xs text-stone-500 underline">
            ← กลับ UI Gallery
          </Link>
        </div>
        <p className="mt-1 text-[11px] text-stone-500">
          DATA → DISPLAY MODEL → RENDER · renderer ตัวเดียวสร้างทุกหน้าจอจากข้อมูล · ตัวอย่างทั้งหมดเป็นโครงสร้าง
          (ไม่ใช่ข้อมูลธุรกิจจริง) · ไม่ได้ embed หรือ copy VS Code
        </p>

        <section className="mt-4 overflow-hidden rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8]">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-[#E9E1D6] px-4 py-2">
            <h2 className="text-sm font-semibold">1 · DISPLAY_PRIMITIVE_MAPPING (SEARCH จากของเดิมเท่านั้น)</h2>
            <span className="ml-auto font-mono text-[10px] text-stone-500">
              REUSE_DIRECT {MAPPING_SUMMARY.reuseDirect} · ADAPT_ONLY {MAPPING_SUMMARY.adaptOnly} · MIXED{" "}
              {MAPPING_SUMMARY.mixedBoundary} · MISSING {MAPPING_SUMMARY.missing} · total {MAPPING_SUMMARY.total}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-[#E9E1D6] text-[10px] uppercase tracking-wide text-stone-400">
                  <th className="px-3 py-1.5">BUSINESS_DISPLAY</th>
                  <th className="px-3 py-1.5">EXISTING_COMPONENT</th>
                  <th className="px-3 py-1.5">EXISTING_BEHAVIOR</th>
                  <th className="px-3 py-1.5">STATE</th>
                </tr>
              </thead>
              <tbody>
                {DISPLAY_PRIMITIVE_MAPPING.map((m) => (
                  <tr key={m.businessDisplay} className="border-b border-[#F0EBE5] align-top hover:bg-[#F7F4EF]">
                    <td className="px-3 py-1.5 font-medium text-stone-700">{m.businessDisplay}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-stone-600">{m.existingComponent}</td>
                    <td className="px-3 py-1.5 text-stone-500">{m.existingBehavior}</td>
                    <td className="px-3 py-1.5">
                      <span className={"rounded-md border px-1.5 py-0.5 text-[10px] " + STATE_STYLE[m.state]}>
                        {m.state}
                      </span>
                      {m.note && <div className="mt-1 text-[10px] text-stone-400">{m.note}</div>}
                      <div className="mt-1 font-mono text-[9px] text-stone-300">{m.evidence}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>


        <section className="mt-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">2 · RENDER จาก display model (ตัวอย่างเชิงโครงสร้าง 8 ชุด)</h2>
            <span className="rounded-md border border-[#E9E1D6] bg-[#FDFBF8] px-2 py-0.5 text-[10px] text-stone-500">
              ทุกชุดใช้ renderer ตัวเดียว — เพิ่มข้อมูลใน display model = ได้หน้าจอเพิ่มเอง
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {SAMPLE_DISPLAY_MODELS.map((m) => (
              <BusinessDisplayRenderer key={m.id} model={m} />
            ))}
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
          <h2 className="text-sm font-semibold">3 · WORKSPACE — แนวพื้นที่ (ยังไม่ implement)</h2>
          <div className="mt-2 grid grid-cols-1 gap-3 text-[11px] text-stone-600 lg:grid-cols-3">
            <div className="rounded-xl border border-[#E9E1D6] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                LEFT · COMMAND / INPUT
              </div>
              <p className="mt-1">
                รับเข้า · Chat · Search · Tools · Sources — reuse <span className="font-mono">ListColumn</span> (ช่องค้นหา +
                ความกว้าง 300/64/0 + collapse) และ <span className="font-mono">ChatInput</span>
              </p>
            </div>
            <div className="rounded-xl border border-[#E9E1D6] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">RIGHT · WORK AREA</div>
              <p className="mt-1">
                เปิดของจริง · Viewer · Table · Document · Diff · Result — reuse{" "}
                <span className="font-mono">Viewer</span> · <span className="font-mono">DataTable</span> ·{" "}
                <span className="font-mono">Inspector</span> + renderer ในหน้านี้
              </p>
            </div>
            <div className="rounded-xl border border-[#E9E1D6] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                BOTTOM · TEMPORARY
              </div>
              <p className="mt-1">
                Problems · Scanner · Validation · Evidence · Activity — reuse <span className="font-mono">Window</span>{" "}
                (variant window/panel) เป็น overlay · ปิดแล้วพื้นที่คืนเต็ม · ไม่มี Top Bar ใหม่
              </p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-stone-400">
            WHITE RULE: พื้นที่ขาวเฉพาะวัตถุจริง (PDF/A4/ใบกำกับ/ใบเสร็จ/ฟอร์ม/ภาพที่ต้นฉบับขาว) — ส่วนรายการ/tree/search/chat/scanner
            อยู่บน workspace background
          </p>
        </section>
      </div>
    </div>
  );
}
