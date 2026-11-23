"use client";

/**
 * VISUAL REVIEW — แสดง icon / logo / image asset ที่มีอยู่จริงทั้งหมดในระบบ
 *
 * วัตถุประสงค์: ให้ Owner เห็น inventory ทางสายตาทั้งหมดในหน้าจอเดียวก่อนตัดสินตำแหน่ง
 * - แสดงของจริงทุกตัว · ไม่ซ่อนหลัง Launcher · ไม่ตัดสินตำแหน่งถาวร
 * - รายการที่ยังไม่มี asset → placeholder + ชื่อ + สถานะ MISSING_ASSET (ไม่补齐ด้วยของปลอม)
 * - ครึ่งล่างเป็น Universal Workspace ตามโครงที่เสนอ (ยังไม่ใช่ implementation)
 *
 * หน้านี้เป็น *หน้าจอ review* เท่านั้น: ไม่มี capability wiring · ไม่ผูก Connect ·
 * ไม่แตะ Canvas/Login/registry · ใช้ palette ที่ Owner อนุมัติจาก Login เท่านั้น
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Image as ImageIcon, Menu, Minus, PanelRight, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { ICON_REGISTRY } from "../_lib/iconRegistry";
import {
  BRAND_ASSETS,
  PROVIDER_BRANDS,
  INTERNAL_CAPABILITY_IDENTITIES,
  BUSINESS_MODULE_ICONS,
  VISUAL_ASSET_SOURCE_NOTES,
  type AssetState,
} from "../_lib/visualAssets";
import DataTable from "@/presentation/table/DataTable";
import FormField from "@/presentation/form/FormField";
import FormActions from "@/presentation/form/FormActions";
import Viewer from "@/presentation/viewer/Viewer";
import { ChatMessageList } from "@/presentation/ai/ChatMessageList";
import { ChatInput } from "@/presentation/ai/ChatInput";
import Window from "@/presentation/panels/Window";
import EmptyState from "@/presentation/feedback/EmptyState";

const STATE_STYLE: Record<AssetState, string> = {
  PRESENT: "text-emerald-700 border-emerald-200 bg-emerald-50",
  UNUSED: "text-stone-500 border-stone-300 bg-stone-50",
  DUPLICATE: "text-amber-700 border-amber-200 bg-amber-50",
  MISSING_ASSET: "text-rose-700 border-rose-200 bg-rose-50",
  REVIEW_REQUIRED: "text-amber-700 border-amber-200 bg-amber-50",
};

function StateChip({ state }: { state: AssetState }) {
  return (
    <span className={"inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-medium " + STATE_STYLE[state]}>
      {state}
    </span>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-[#D5C8B6] bg-[#F7F4EF] text-[9px] text-stone-400">
      {label}
    </div>
  );
}

type SurfaceKey = "empty" | "viewer" | "table" | "form" | "conversation" | "document";

export default function VisualReviewPage() {
  const [surface, setSurface] = useState<SurfaceKey>("empty");
  const [panelOpen, setPanelOpen] = useState<null | "inspector" | "preview">(null);

  const iconByName = useMemo(() => new Map(ICON_REGISTRY.map((e) => [e.name, e.Icon])), []);

  const counts = {
    brandFiles: BRAND_ASSETS.length,
    providers: PROVIDER_BRANDS.length,
    providerMissing: PROVIDER_BRANDS.filter((p) => p.assetState === "MISSING_ASSET").length,
    providerReview: PROVIDER_BRANDS.filter((p) => p.assetState === "REVIEW_REQUIRED").length,
    internal: INTERNAL_CAPABILITY_IDENTITIES.length,
    business: BUSINESS_MODULE_ICONS.length,
    system: ICON_REGISTRY.length,
  };

  const surfaces: { key: SurfaceKey; label: string }[] = [
    { key: "empty", label: "ว่างเปล่า" },
    { key: "viewer", label: "Viewer (ภาพจริง)" },
    { key: "table", label: "Table" },
    { key: "form", label: "Form" },
    { key: "conversation", label: "Conversation" },
    { key: "document", label: "Document" },
  ];

  return (
    <div className="min-h-screen bg-[#F0EBE5] p-4 text-stone-800">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-wrap items-center gap-3">
          <ImageIcon className="h-5 w-5 text-stone-500" />
          <h1 className="text-lg font-bold">VISUAL REVIEW — icon / logo / image ที่มีอยู่จริง</h1>
          <span className="rounded-lg border border-[#E9E1D6] bg-[#FDFBF8] px-2 py-1 text-[11px] text-stone-500">
            brand files {counts.brandFiles} · provider {counts.providers} · business icons {counts.business} · internal{" "}
            {counts.internal} · system icons {counts.system}
          </span>
          <Link href="/admin/ui-gallery" className="ml-auto text-xs text-stone-500 underline">
            ← กลับ UI Gallery
          </Link>
        </div>
        <p className="mt-1 text-[11px] text-stone-500">
          ส่วนนี้เป็น REVIEW INVENTORY เท่านั้น — ไม่ใช่ Top Bar · ไม่ใช่ Navigation Architecture · ยังไม่ล็อกตำแหน่ง
        </p>

        <Link href="/admin/ui-gallery/assistants" className="mt-4 block rounded-xl border border-[#D5C8B6] bg-[#FDFBF8] p-4 text-sm hover:bg-[#F7F4EF]">
          พนักงานผู้ช่วย · น้องพร้อม / น้องแฟ้ม / น้องมิว / น้องออร์บ → ทดลองการขยับและบุคลิก
        </Link>

        {/* 1) BRAND / APP / PWA */}
        <section className="mt-4 rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
          <h2 className="text-sm font-semibold">1 · BRAND / APP / PWA — ไฟล์จริงในเครื่อง</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {BRAND_ASSETS.map((a) => (
              <div key={a.key} className="flex flex-col items-center gap-1.5 text-center">
                {a.url ? (
                  <img
                    src={a.url}
                    alt={a.displayName}
                    className="h-14 w-14 rounded-xl border border-[#E9E1D6] bg-white object-contain p-1"
                  />
                ) : (
                  <Placeholder label="no file" />
                )}
                <div className="text-[11px] font-medium leading-tight">{a.displayName}</div>
                <StateChip state={a.state} />
                <div className="text-[9px] leading-tight text-stone-400">{a.sourcePath}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-stone-400">
            ตัวอย่างที่ยกมา: PWA 512/192 · apple-touch · next/vercel/window.svg (UNUSED) ·
            favicon 2 ไฟล์ (คนละภาพ บทบาทซ้ำ) · desktop icon set 29 ไฟล์
          </p>
        </section>


        {/* 2) PROVIDER LOGOS */}
        <section className="mt-3 rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
          <h2 className="text-sm font-semibold">2 · PROVIDER LOGOS — สถานะจาก provider-metadata.ts ของ INFRA</h2>
          <p className="mt-1 text-[11px] text-stone-500">
            มีไฟล์โลโก้จริง 1 รายการ (DNA OS) · REVIEW_REQUIRED {counts.providerReview} · MISSING_ASSET{" "}
            {counts.providerMissing} — รายการที่ไม่มี asset แสดง placeholder ไม่ได้วาดขึ้นเอง
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {PROVIDER_BRANDS.map((p) => (
              <div key={p.providerId} className="flex flex-col items-center gap-1.5 text-center">
                {p.assetState === "PRESENT" ? (
                  <img
                    src="/brand/dna-os-mark-d.png"
                    alt={p.displayName}
                    className="h-14 w-14 rounded-xl border border-[#E9E1D6] bg-white object-contain p-1"
                  />
                ) : (
                  <Placeholder label="MISSING" />
                )}
                <div className="text-[11px] font-medium leading-tight">{p.displayName}</div>
                <StateChip state={p.assetState} />
                <div className="text-[9px] text-stone-400">{p.providerId}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 3) INTERNAL CAPABILITY IDENTITIES */}
        <section className="mt-3 rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
          <h2 className="text-sm font-semibold">3 · INTERNAL CAPABILITY IDENTITIES — ใช้ generic mark ร่วมกัน</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {INTERNAL_CAPABILITY_IDENTITIES.map((c) => (
              <div key={c.providerId} className="flex flex-col items-center gap-1.5 text-center">
                <img
                  src="/brand/dna-os-integration-generic.svg"
                  alt={c.displayName}
                  className="h-14 w-14 rounded-xl border border-[#E9E1D6] bg-white object-contain p-1"
                />
                <div className="text-[11px] font-medium">{c.displayName}</div>
                <StateChip state={c.assetState} />
                <div className="text-[9px] text-stone-400">{c.providerId}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 4) BUSINESS MODULE ICONS */}
        <section className="mt-3 rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
          <h2 className="text-sm font-semibold">4 · BUSINESS MODULE ICONS — ตัวที่ระบบใช้จริงต่อโมดูล</h2>
          <div className="mt-3 grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-7">
            {BUSINESS_MODULE_ICONS.map((m) => {
              const Icon = iconByName.get(m.iconName);
              return (
                <div key={m.key} className="flex flex-col items-center gap-1 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-[#E9E1D6] bg-white">
                    {Icon ? <Icon className="h-6 w-6 text-stone-700" /> : <Placeholder label="?" />}
                  </div>
                  <div className="text-[11px] font-medium leading-tight">{m.label}</div>
                  <div className="text-[9px] text-stone-400">{m.iconName}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 5) SYSTEM ICONS — ทั้งหมด ไม่ซ่อน */}
        <section className="mt-3 rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
          <h2 className="text-sm font-semibold">
            5 · SYSTEM ICONS — {counts.system} ตัวที่ระบบ import จริง (ไม่ซ่อนหลัง Launcher)
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-10">
            {ICON_REGISTRY.map(({ name, Icon }) => (
              <div key={name} className="flex flex-col items-center gap-1 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E9E1D6] bg-white">
                  <Icon className="h-4 w-4 text-stone-700" />
                </div>
                <div className="break-all text-[9px] leading-tight text-stone-500">{name}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="my-5 border-t border-[#E3DACE]" />


        {/* UNIVERSAL WORKSPACE — โครงที่เสนอ (ยังไม่ใช่ implementation) */}
        <section>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">UNIVERSAL WORKSPACE — ตัวอย่างโครง (ยังไม่ผูก capability)</h2>
            <span className="rounded-md border border-[#E9E1D6] bg-[#FDFBF8] px-2 py-0.5 text-[10px] text-stone-500">
              region เดียว · เปลี่ยน surface ไม่ใช่เปลี่ยนหน้า · ไม่มีแถบถาวร
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {surfaces.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSurface(s.key)}
                  className={
                    "rounded-lg border px-2 py-1 text-[10px] transition-colors " +
                    (surface === s.key
                      ? "border-[#B49C7C] bg-[#F7F4EF] text-stone-800"
                      : "border-[#E9E1D6] bg-[#FDFBF8] text-stone-500 hover:border-[#D5C8B6]")
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative mt-3 h-[560px] overflow-hidden rounded-2xl bg-[#F0EBE5]">
            {/* FLOATING CONTROLS — ไม่จองพื้นที่ */}
            <div className="absolute left-3 top-3 z-20 flex items-center gap-1">
              <button
                type="button"
                aria-label="Launcher (ตัวอย่าง)"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E9E1D6] bg-[#FDFBF8] text-stone-500 hover:text-stone-800"
              >
                <Menu className="h-4 w-4" />
              </button>
            </div>
            <div className="absolute right-3 top-3 z-20 flex items-center gap-1">
              <button
                type="button"
                aria-label="ค้นหา (ตัวอย่าง)"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E9E1D6] bg-[#FDFBF8] text-stone-500 hover:text-stone-800"
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="คำสั่ง (ตัวอย่าง)"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E9E1D6] bg-[#FDFBF8] text-stone-500 hover:text-stone-800"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="ทดลองค่า (ยังไม่ผูก)"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E9E1D6] bg-[#FDFBF8] text-stone-500 hover:text-stone-800"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>
            <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPanelOpen(panelOpen === "inspector" ? null : "inspector")}
                aria-label="Inspector (ชั่วคราว)"
                className={
                  "flex h-8 w-8 items-center justify-center rounded-lg border text-stone-600 " +
                  (panelOpen === "inspector" ? "border-[#B49C7C] bg-[#F7F4EF]" : "border-[#E9E1D6] bg-[#FDFBF8]")
                }
              >
                <PanelRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPanelOpen(panelOpen === "preview" ? null : "preview")}
                aria-label="Preview (ชั่วคราว)"
                className={
                  "flex h-8 w-8 items-center justify-center rounded-lg border text-stone-600 " +
                  (panelOpen === "preview" ? "border-[#B49C7C] bg-[#F7F4EF]" : "border-[#E9E1D6] bg-[#FDFBF8]")
                }
              >
                <ImageIcon className="h-4 w-4" />
              </button>
            </div>

            {/* WORKSPACE SURFACE — region เดียว */}
            <div className="h-full bg-[#FDFBF8] p-4 pt-14">
              {surface === "empty" && (
                <EmptyState message="ยังไม่มีข้อมูล" hint="region เดียวรองรับทุก surface — เปลี่ยนจากปุ่มด้านบน" />
              )}
              {surface === "viewer" && (
                <Viewer kind="image" src="/brand/dna-os-mark-d.png" alt="DNA OS mark" zoom={1} />
              )}
              {surface === "table" && (
                <DataTable<Record<string, string>>
                  columns={[
                    { key: "a", label: "คอลัมน์ A" },
                    { key: "b", label: "คอลัมน์ B" },
                  ]}
                  rows={[]}
                  rowKey={(_, i) => String(i)}
                  renderCell={() => null}
                  emptyMessage="ยังไม่มีข้อมูล"
                />
              )}
              {surface === "form" && (
                <div className="mx-auto max-w-md space-y-4">
                  <FormField id="demo-a" label="ช่องกรอก A">
                    <input
                      id="demo-a"
                      className="w-full rounded-xl border border-[#E3DACE] bg-[#F7F4EF] px-3 py-2 text-sm outline-none"
                      placeholder="ตัวอย่างช่องกรอก (ยังไม่ผูก)"
                    />
                  </FormField>
                  <FormActions>
                    <button type="button" className="rounded-lg border border-[#E9E1D6] px-3 py-1.5 text-xs">
                      ยกเลิก
                    </button>
                    <button type="button" className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs text-white">
                      บันทึก
                    </button>
                  </FormActions>
                </div>
              )}
              {surface === "conversation" && (
                <div className="flex h-full flex-col">
                  <div className="flex-1 overflow-hidden">
                    <ChatMessageList messages={[]} activeClarifyId={null} onChoose={() => {}} running={false} />
                  </div>
                  <ChatInput onSend={() => {}} disabled />
                </div>
              )}
              {surface === "document" && (
                <Viewer
                  kind="document"
                  html="<div style='font-family:system-ui;padding:24px;color:#57534e'>ตัวอย่างพื้นที่เอกสาร — ผู้เรียกเป็นเจ้าของ HTML จริง</div>"
                  documentHeight={300}
                />
              )}
            </div>

            {/* TEMPORARY PANEL — overlay เท่านั้น (ไม่จองพื้นที่) */}
            {panelOpen && (
              <div className="absolute inset-0 z-30 flex justify-end bg-black/10" onClick={() => setPanelOpen(null)}>
                <div className="m-3 h-[calc(100%-1.5rem)]" onClick={(e) => e.stopPropagation()}>
                  {panelOpen === "inspector" ? (
                    <Window
                      title="Inspector"
                      subtitle="panel ชั่วคราว — ปิดแล้วพื้นที่คืนเต็ม"
                      onClose={() => setPanelOpen(null)}
                      width={300}
                    >
                      <div className="space-y-2 p-3 text-xs text-stone-500">
                        <div>เปิดทีละ 1 panel · ปิดด้วย Esc หรือคลิก backdrop</div>
                        <div>ไม่จองพื้นที่ · ไม่ persist</div>
                      </div>
                    </Window>
                  ) : (
                    <Window title="Preview" subtitle="overlay/drawer เท่านั้น" onClose={() => setPanelOpen(null)} width={380}>
                      <div className="p-3">
                        <Viewer kind="image" src="/brand/dna-os-integration-generic.svg" alt="generic mark" zoom={1} />
                      </div>
                    </Window>
                  )}
                </div>
              </div>
            )}
          </div>

          <p className="mt-2 text-[10px] text-stone-500">
            ปุ่มไอคอนในกรอบนี้เป็นตัวแทนตำแหน่งชั่วคราวเพื่อ review — ตำแหน่งจริงยังไม่ล็อก · หน้านี้ไม่ซ่อนไอคอนหลัง
            Launcher (icon ทั้งหมดแสดงอยู่ด้านบนแล้ว)
          </p>
        </section>

        {/* หลักฐานของตัวเลข */}
        <section className="mt-5 rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
          <h3 className="text-sm font-semibold">หลักฐานของตัวเลขในหน้านี้</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-stone-600">
            {VISUAL_ASSET_SOURCE_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
