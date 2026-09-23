"use client";

// UI Gallery — INDEX (/admin/ui-gallery)
//
// คลัง UI สำเร็จรูปของ DNA OS: เลือก UI → preview → compare
//   - แสดง UI จริงจาก source เดิม (route → iframe same-origin / component → import จริง)
//   - ไม่มีสำเนา UI, ไม่มี mock UI, ไม่ redesign
//   - ใช้ auth/middleware เดิมของ /admin (ไม่แตะ middleware.ts)
//   - ข้อมูลทั้งหมดมาจาก _lib/uiCatalog.ts + _lib/uiIndex.ts (presentation metadata)
//
// หน้านี้เป็น "ตัวจัดเรียง/ตัวนำทาง" เท่านั้น — ไม่ render UI ต้นทางเอง (ทำที่ preview/lab)

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Image as ImageIcon } from "lucide-react";
import {
  UI_CATEGORY_ORDER,
  UI_COMPARE_PRESETS,
  UI_COUNTS,
  PRESENTATION_COUNTS,
  filterUiItems,
  getUiItem,
  presentationItemsByGroup,
  uiBadges,
  type UiCategory,
  type UiItem,
} from "./_lib/uiIndex";
import { ASSEMBLIES } from "./_lib/assemblies";
import { hasHost } from "./_lib/componentHost";

const BRANCH_FILTERS = ["all", "main", "branch"] as const;
const MODE_FILTERS = ["all", "route", "component", "blocked"] as const;

const MODE_LABEL: Record<string, string> = {
  all: "ทุกโหมด",
  route: "route (iframe)",
  component: "component จริง",
  blocked: "preview ตรง ๆ ไม่ได้",
};

const BADGE_STYLE: Record<string, string> = {
  "branch-only": "bg-purple-50 text-purple-700 border-purple-200",
  orphan: "bg-rose-50 text-rose-700 border-rose-200",
  "ข้อมูลจริง": "bg-amber-50 text-amber-700 border-amber-200",
  "เขียนได้": "bg-orange-50 text-orange-700 border-orange-200",
  "preview ตรง ๆ ไม่ได้": "bg-stone-100 text-stone-500 border-stone-200",
  "component จริง": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "route จริง": "bg-blue-50 text-blue-700 border-blue-200",
};

export default function UiGalleryIndexPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<UiCategory | "all">("all");
  const [branch, setBranch] = useState<(typeof BRANCH_FILTERS)[number]>("all");
  const [mode, setMode] = useState<(typeof MODE_FILTERS)[number]>("all");
  const [selected, setSelected] = useState<string[]>([]);

  const items = useMemo(
    () => filterUiItems({ query, category, branch, renderMode: mode }),
    [query, category, branch, mode]
  );

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedItems = useMemo(() => items.filter((i) => selected.includes(i.id)), [items, selected]);
  const selectedRouteItems = selectedItems.filter((i) => i.renderMode === "route");

  function openCompare() {
    const pool = selectedRouteItems.length >= 2 ? selectedRouteItems : selectedItems;
    if (pool.length === 0) return;
    router.push(`/admin/ui-gallery/compare?ids=${pool.slice(0, 4).map((i) => i.id).join(",")}`);
  }

  return (
    <div className="p-6 max-w-[1400px]">
      <header>
        <h1 className="text-xl font-bold text-stone-900">UI Gallery</h1>
        <a
          href="/admin/ui-gallery/visual-review"
          className="ml-3 inline-flex items-center gap-1.5 rounded-lg border border-[#E9E1D6] bg-[#FDFBF8] px-2.5 py-1 text-xs text-stone-600 hover:border-[#D5C8B6]"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          Visual Review — icon / logo / asset ทั้งหมด
        </a>
        <a
          href="/admin/ui-gallery/business-display"
          className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-[#E9E1D6] bg-[#FDFBF8] px-2.5 py-1 text-xs text-stone-600 hover:border-[#D5C8B6]"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          Business Display — display model + primitive mapping
        </a>
        <p className="mt-1 text-xs text-stone-500">
          คลัง UI สำเร็จรูปของ DNA OS — เลือกเพื่อเปิด preview หรือเปรียบเทียบ โดยแสดง UI จริงจาก source เดิม
          (route → iframe same-origin, component → import component จริง) ไม่มีสำเนา ไม่มี mock ไม่ redesign
        </p>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="UI ทั้งหมดในคลัง" value={UI_COUNTS.total} />
        <Stat label="main" value={UI_COUNTS.main} />
        <Stat label="branch-only" value={UI_COUNTS.branch} />
        <Stat label="preview ได้" value={UI_COUNTS.previewable} />
        <Stat label="preview ตรง ๆ ไม่ได้" value={UI_COUNTS.byRenderMode.blocked} />
        <Stat label="ต้องมีข้อมูลจริง" value={UI_COUNTS.needsRealData} />
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-500">
        {UI_CATEGORY_ORDER.map((c) => (
          <span key={c} className="rounded-full border border-stone-200 bg-white px-2.5 py-1">
            {c} {UI_COUNTS.byCategory[c] ?? 0}
          </span>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4 space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหา (path / ชื่อ / route / shell)"
          className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
        />
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip active={category === "all"} onClick={() => setCategory("all")}>ทุกหมวด</FilterChip>
          {UI_CATEGORY_ORDER.map((c) => (
            <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c} ({UI_COUNTS.byCategory[c] ?? 0})
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {BRANCH_FILTERS.map((b) => (
            <FilterChip key={b} active={branch === b} onClick={() => setBranch(b)}>
              {b === "all" ? "ทุก branch" : b}
            </FilterChip>
          ))}
          <span className="mx-1 h-4 w-px bg-stone-200" />
          {MODE_FILTERS.map((m) => (
            <FilterChip key={m} active={mode === m} onClick={() => setMode(m)}>
              {MODE_LABEL[m]}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
        <span className="text-xs text-stone-600">
          แสดง {items.length} UI · เลือกแล้ว {selectedItems.length}
        </span>
        <button
          type="button"
          onClick={() => setSelected(items.map((i) => i.id))}
          className="text-xs rounded-lg border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-white"
        >
          เลือกทั้งหมดที่กรองอยู่
        </button>
        <button
          type="button"
          onClick={() => setSelected([])}
          className="text-xs rounded-lg border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-white"
        >
          ล้างที่เลือก
        </button>
        <span className="flex-1" />
        <button
          type="button"
          disabled={selectedItems.length === 0}
          onClick={() => {
            const first = selectedItems.find((i) => i.renderMode !== "blocked") ?? selectedItems[0];
            if (first) router.push(`/admin/ui-gallery/preview?id=${first.id}`);
          }}
          className="text-xs rounded-lg bg-stone-900 px-3 py-1.5 text-white disabled:opacity-40"
        >
          เปิด preview (ตัวแรกที่เลือก)
        </button>
        <button
          type="button"
          disabled={selectedItems.length < 2}
          onClick={openCompare}
          className="text-xs rounded-lg bg-stone-900 px-3 py-1.5 text-white disabled:opacity-40"
        >
          เปรียบเทียบ {selectedRouteItems.length >= 2 ? selectedRouteItems.length : selectedItems.length} UI
        </button>
      </div>
      {selectedItems.length >= 2 && selectedRouteItems.length < 2 && (
        <p className="mt-2 text-[11px] text-amber-700">
          หมายเหตุ: compare เปิด iframe ได้เฉพาะ UI ที่มี route จริง — ที่เลือกอยู่มี route {selectedRouteItems.length} ตัว
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
        <span>Preset ที่มีอยู่:</span>
        {UI_COMPARE_PRESETS.map((p) => (
          <Link
            key={p.id}
            href={`/admin/ui-gallery/compare?preset=${p.id}`}
            className="rounded-full border border-stone-200 bg-white px-2.5 py-1 hover:border-stone-400"
            title={p.reason}
          >
            {p.label} ({p.itemIds.length})
          </Link>
        ))}
      </div>

      {/* ── ประกอบหน้าจอ (Assembly) — UI ที่ประกอบแล้วจาก component จริง ── */}
      <section className="mt-6 rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">
            ประกอบหน้าจอ — {ASSEMBLIES.length} รูปแบบที่ประกอบได้จริง
          </h2>
          <p className="mt-1 text-[11px] text-stone-500">
            ทุกชุดประกอบจาก component จริงใน repo (ไม่มีสำเนา ไม่มี mock) · action ที่ยังไม่มี backend แสดงปุ่มจริงแต่ disable + ป้าย NOT WIRED ·{" "}
            เปิดใน LAB เพื่อทดลอง หรือเปิดเต็มหน้าจอ / เทียบกับรูปแบบอื่น
          </p>
        </div>
        <div className="divide-y divide-stone-100">
          {ASSEMBLIES.map((a) => (
            <div key={a.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-stone-800">{a.name}</span>
                <span className="text-[11px] text-stone-500">{a.entry}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {a.componentsUsed.map((c) => (
                  <span key={c} className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] text-stone-600">
                    {c}
                  </span>
                ))}
              </div>

              <div className="mt-2 font-mono text-[10px] break-all text-stone-400">
                {a.sourceEvidence.slice(0, 2).join("  ·  ")}
                {a.sourceEvidence.length > 2 ? `  ·  +${a.sourceEvidence.length - 2}` : ""}
              </div>

              {a.notWiredActions.length > 0 && (
                <div className="mt-2 text-[10px] text-amber-700">NOT WIRED: {a.notWiredActions.join(" · ")}</div>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/admin/ui-gallery/lab?assembly=${a.id}`}
                  className="rounded-full border border-stone-300 px-2.5 py-0.5 text-[11px] text-stone-700 hover:border-stone-500"
                >
                  เปิดใน LAB
                </Link>
                <a
                  href={`/admin/ui-gallery/lab?assembly=${a.id}&full=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-stone-300 px-2.5 py-0.5 text-[11px] text-stone-700 hover:border-stone-500"
                >
                  เปิดเต็มหน้าจอ ↗
                </a>
                <a
                  href={`/admin/ui-gallery/lab?assembly=${a.id}&compare=${
                    ASSEMBLIES.find((x) => x.id !== a.id)?.id ?? ""
                  }`}
                  className="rounded-full border border-stone-300 px-2.5 py-0.5 text-[11px] text-stone-700 hover:border-stone-500"
                >
                  เทียบกับรูปแบบอื่น
                </a>
                {a.routePreview?.[0] && (
                  <a
                    href={a.routePreview[0].route}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] text-blue-700"
                  >
                    route จริง: {a.routePreview[0].route} ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRESENTATION CANONICAL (34 ไฟล์) — ให้ Owner ดูของจริงก่อนประกาศ canonical ── */}
      <section className="mt-6 rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">
            Presentation Canonical — {PRESENTATION_COUNTS.total} ไฟล์ใน presentation/
          </h2>
          <p className="mt-1 text-[11px] text-stone-500">
            renderable {PRESENTATION_COUNTS.renderable} · non-visual {PRESENTATION_COUNTS.nonVisual} (token/config — แสดงผลที่มันควบคุม) ·{" "}
            {PRESENTATION_COUNTS.groups} กลุ่ม · ทุกแถวเปิด preview ของจริงได้ (component จริง ไม่มี mock UI) · ใช้ source ปัจจุบันเท่านั้น
          </p>
        </div>
        <div className="divide-y divide-stone-100">
          {presentationItemsByGroup().map(({ group, items: groupItems }) => (
            <div key={group} className="px-4 py-3">
              <div className="text-xs font-semibold text-stone-700">
                {group} <span className="font-normal text-stone-400">({groupItems.length})</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {groupItems.map((p) => {
                  const target = getUiItem(p.uiItemId);
                  return (
                    <div key={p.path} className="flex flex-wrap items-center gap-2 text-[11px]">
                      <code className="font-mono text-stone-600">{p.path}</code>
                      <span
                        className={
                          "rounded-full border px-2 py-0.5 " +
                          (p.kind === "renderable"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-stone-200 bg-stone-50 text-stone-500")
                        }
                      >
                        {p.kind === "renderable" ? "renderable" : "non-visual"}
                      </span>
                      {p.controls && <span className="text-stone-400">ควบคุม: {p.controls}</span>}
                      {target && (
                        <Link
                          href={`/admin/ui-gallery/preview?id=${target.id}`}
                          className="rounded-full border border-stone-300 px-2 py-0.5 text-stone-600 hover:border-stone-500"
                        >
                          เปิด preview →
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-5 space-y-5">
        {UI_CATEGORY_ORDER.map((cat) => {
          const catItems = items.filter((i) => i.category === cat);
          if (catItems.length === 0) return null;
          return (
            <section key={cat}>
              <h2 className="text-sm font-semibold text-stone-800">
                {cat} <span className="text-stone-400 font-normal">({catItems.length})</span>
              </h2>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                {catItems.map((item) => (
                  <UiRow
                    key={item.id}
                    item={item}
                    selected={selected.includes(item.id)}
                    onToggle={() => toggle(item.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
        {items.length === 0 && <p className="text-xs text-stone-400">ไม่พบ UI ที่ตรงกับตัวกรอง</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-stone-900">{value}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-[11px] rounded-full border px-2.5 py-1 transition-colors " +
        (active
          ? "border-stone-900 bg-stone-900 text-white"
          : "border-stone-200 bg-white text-stone-600 hover:border-stone-400")
      }
    >
      {children}
    </button>
  );
}

function UiRow({ item, selected, onToggle }: { item: UiItem; selected: boolean; onToggle: () => void }) {
  const hostOk = item.renderMode === "component" ? hasHost(item.hostKey) : true;
  return (
    <div className={"rounded-xl border bg-white p-3 transition-colors " + (selected ? "border-stone-900" : "border-stone-200")}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1" aria-label={`เลือก ${item.label}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-stone-800">{item.label}</span>
            {uiBadges(item).map((b) => (
              <span
                key={b}
                className={
                  "rounded-full border px-2 py-0.5 text-[10px] " +
                  (BADGE_STYLE[b] ?? "border-stone-200 bg-stone-50 text-stone-500")
                }
              >
                {b}
              </span>
            ))}
            {!hostOk && (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                ยังไม่มีโฮสต์
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-[10px] text-stone-400 break-all">{item.path}</div>
          {item.route && (
            <div className="mt-0.5 text-[11px] text-stone-500">
              route: <span className="font-mono">{item.route}</span>
            </div>
          )}
          {item.shell && <div className="mt-0.5 text-[11px] text-stone-400">shell: {item.shell}</div>}
          {item.notes && <div className="mt-1 text-[11px] text-stone-500">{item.notes}</div>}
          {item.blockedReason && <div className="mt-1 text-[11px] text-amber-700">{item.blockedReason}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/ui-gallery/preview?id=${item.id}`}
              className="text-[11px] rounded-lg border border-stone-300 px-2.5 py-1 text-stone-600 hover:bg-stone-50"
            >
              เปิด preview
            </Link>
            {item.renderMode === "route" && item.route && (
              <a
                href={item.route}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] rounded-lg border border-stone-300 px-2.5 py-1 text-stone-600 hover:bg-stone-50"
              >
                เปิด route จริง ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

