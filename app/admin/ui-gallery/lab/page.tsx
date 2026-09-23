"use client";

// UI Gallery — LAB (/admin/ui-gallery/lab)
//
// Owner ข้อ 9: LAB ต้องเลือกทดลองได้ — Workspace, Shell, Sidebar/IconRail, Layout,
// Board, Panel, Component, Canvas, Template
//
// ทุกอย่างคือการส่ง props ให้ "component จริง" (ผ่าน _lib/componentHost.tsx) หรือ
// เปิด route จริงด้วย iframe — ไม่มีสำเนา UI, ไม่มี mock UI, ไม่ redesign
// props ที่ LAB ใช้คือ props ที่ component ต้นทางประกาศไว้จริงเท่านั้น

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { listUiItems, type UiItem, type UiCategory } from "../_lib/uiIndex";
import { REAL_RAIL_ITEMS, hasHost, renderHost, type HostProps } from "../_lib/componentHost";
import { ASSEMBLIES, getAssembly } from "../_lib/assemblies";
import { AssemblyHost } from "../_lib/assemblyHost";
import type { BoardType } from "@/core/workspace/board";

const LAB_GROUPS: { id: string; label: string; categories: UiCategory[]; hint: string }[] = [
  { id: "workspace", label: "Workspace", categories: ["Full Workspace"], hint: "เปิด workspace จริงเป็น route ในกรอบ iframe" },
  { id: "shell", label: "Shell", categories: ["Shell"], hint: "สลับ shell จริง + ปรับ rail items / theme" },
  { id: "sidebar", label: "Sidebar / IconRail", categories: ["Sidebar"], hint: "ปรับ rail items และความกว้างของ ListColumn" },
  { id: "layout", label: "Layout", categories: ["Layout"], hint: "Next layout ไม่ render เดี่ยวได้ — ดูผ่าน route ตัวแทน" },
  { id: "board", label: "Board", categories: ["Board"], hint: "สลับ board type ผ่าน core/workspace/boardRouter.ts ด้วย EMPTY_RENDER_MODEL" },
  { id: "panel", label: "Panel", categories: ["Panel"], hint: "panel เดี่ยวที่แยกเป็นไฟล์ได้ (ตัวที่ต้อง route จะเปิดเป็น iframe)" },
  { id: "component", label: "Component", categories: ["Component"], hint: "component จริงจาก components/**" },
  { id: "canvas", label: "Canvas", categories: ["Canvas"], hint: "Canvas จริง + layout จาก workspaceLayoutStore.createEmpty()" },
  { id: "template", label: "Template", categories: ["Template"], hint: "UI branch-only ที่นำเข้าอย่างปลอดภัยแล้ว" },
  { id: "business", label: "Business Page", categories: ["Business Page"], hint: "หน้าที่เหลือของ Main UI — เปิด route จริงใน iframe (ตัวที่ต้องมี id/param จริงจะเปิดไม่ได้)" },
];

const BOARD_TYPES: BoardType[] = ["dashboard", "business", "finance", "partner", "mobile"];

export default function UiGalleryLabPage() {
  const [groupId, setGroupId] = useState("shell");
  const [itemId, setItemId] = useState<string | null>(null);

  const [railKeys, setRailKeys] = useState<string[]>(REAL_RAIL_ITEMS.map((r) => r.key));
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [boardType, setBoardType] = useState<BoardType>("dashboard");
  const [listCollapsible, setListCollapsible] = useState(true);
  const [nonce, setNonce] = useState(0);

  const group = LAB_GROUPS.find((g) => g.id === groupId) ?? LAB_GROUPS[0];
  const groupItems = useMemo(
    () => listUiItems().filter((i) => group.categories.includes(i.category)),
    [group]
  );
  const item: UiItem | undefined = groupItems.find((i) => i.id === itemId) ?? groupItems[0];

  const hostProps: HostProps = { railKeys, theme, boardType, listCollapsible };

  const showRailControl = item?.hostKey === "shell-app-shell" || item?.hostKey === "sidebar-icon-rail";
  const showThemeControl = item?.hostKey === "shell-workspace-shell";
  const showBoardControl = item?.hostKey === "board-type-any";
  const showListControl = item?.hostKey === "sidebar-list-column";
  const showCanvasControl = item?.hostKey === "canvas-editor";

  function resetProps() {
    setRailKeys(REAL_RAIL_ITEMS.map((r) => r.key));
    setTheme("dark");
    setBoardType("dashboard");
    setListCollapsible(true);
    setNonce((n) => n + 1);
  }

  const hostOk = item ? (item.renderMode === "component" ? hasHost(item.hostKey) : true) : false;

  // ── โหมด "ประกอบหน้าจอ" (Assembly) — Owner UI Assembly Lab ────────────────
  // ประกอบจาก component จริงเท่านั้น; เปิดได้จาก Gallery ด้วย ?assembly=<id>&compare=<id2>&full=1
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"inventory" | "assembly">(searchParams.get("assembly") ? "assembly" : "inventory");
  const [assemblyId, setAssemblyId] = useState<string>(searchParams.get("assembly") ?? ASSEMBLIES[0].id);
  const [compareId, setCompareId] = useState<string>(searchParams.get("compare") ?? "");
  const full = searchParams.get("full") === "1";
  const assembly = getAssembly(assemblyId) ?? ASSEMBLIES[0];
  const compareAssembly = compareId ? getAssembly(compareId) : undefined;

  useEffect(() => {
    const a = searchParams.get("assembly");
    if (a) {
      setMode("assembly");
      setAssemblyId(a);
    }
    const c = searchParams.get("compare");
    if (c) setCompareId(c);
  }, [searchParams]);

  if (mode === "assembly") {
    if (full) {
      return (
        <div className="min-h-screen bg-stone-50">
          <AssemblyHost id={assembly.id} />
        </div>
      );
    }

    return (
      <div className="p-6">
        <Link href="/admin/ui-gallery" className="text-[11px] text-stone-500 underline">
          ← กลับไป UI Gallery
        </Link>
        <h1 className="mt-1 text-xl font-bold text-stone-900">UI Lab — ประกอบหน้าจอ (Assembly)</h1>
        <p className="mt-1 text-xs text-stone-500">
          ประกอบจาก component จริงเท่านั้น (ไม่มีสำเนา ไม่มี mock) · action ที่ยังไม่มี backend แสดงปุ่มจริงแต่ disable + ป้าย NOT WIRED
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("inventory")}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-400"
          >
            UI เดี่ยว (inventory)
          </button>
          <button type="button" className="rounded-lg border border-stone-900 bg-stone-900 px-3 py-1.5 text-xs text-white">
            🧩 ประกอบหน้าจอ (Assembly)
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {ASSEMBLIES.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setAssemblyId(a.id);
                if (compareId === a.id) setCompareId("");
              }}
              className={
                "rounded-lg border px-3 py-1.5 text-xs transition-colors " +
                (a.id === assembly.id
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-600 hover:border-stone-400")
              }
            >
              {a.name}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="text-sm font-semibold text-stone-800">{assembly.name}</div>
              <p className="mt-1 text-[11px] text-stone-500">{assembly.entry}</p>
              <div className="mt-3 text-[10px] uppercase tracking-wide text-stone-400">components ที่ใช้</div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-stone-600">
                {assembly.componentsUsed.map((c) => (
                  <li key={c}>· {c}</li>
                ))}
              </ul>

              <div className="mt-3 text-[10px] uppercase tracking-wide text-stone-400">หลักฐานใน source</div>
              <ul className="mt-1 space-y-0.5 font-mono text-[10px] break-all text-stone-500">
                {assembly.sourceEvidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>

              <div className="mt-3 text-[10px] uppercase tracking-wide text-emerald-600">action ที่ใช้ได้จริง</div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-stone-600">
                {assembly.availableActions.map((a) => (
                  <li key={a}>· {a}</li>
                ))}
              </ul>

              {assembly.notWiredActions.length > 0 && (
                <>
                  <div className="mt-3 text-[10px] uppercase tracking-wide text-amber-600">NOT WIRED</div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700">
                    {assembly.notWiredActions.map((a) => (
                      <li key={a}>· {a}</li>
                    ))}
                  </ul>
                </>
              )}

            </div>
            {assembly.routePreview && assembly.routePreview.length > 0 && (
              <div className="rounded-xl border border-stone-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-wide text-stone-400">route จริงที่เปิดเทียบได้</div>
                <div className="mt-2 space-y-1">
                  {assembly.routePreview.map((r) => (
                    <a
                      key={r.route}
                      href={r.route}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[11px] text-stone-600 underline"
                    >
                      {r.label} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wide text-stone-400">เทียบกับรูปแบบอื่น</div>
              <select
                value={compareId}
                onChange={(e) => setCompareId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700"
              >
                <option value="">— ไม่เทียบ —</option>
                {ASSEMBLIES.filter((a) => a.id !== assembly.id).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <a
                href={`/admin/ui-gallery/lab?assembly=${assembly.id}${compareId ? `&compare=${compareId}` : ""}&full=1`}
                className="mt-2 inline-block rounded-lg border border-stone-300 px-2.5 py-1 text-[11px] text-stone-600"
              >
                เปิดเต็มหน้าจอ ↗
              </a>
            </div>

          </aside>
          <main className="min-w-0 space-y-3">
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <div className="border-b border-stone-100 px-3 py-2 font-mono text-[11px] text-stone-500">
                {assembly.id} — เรนเดอร์จาก component จริง (ไม่ใช่ iframe)
              </div>
              <AssemblyHost id={assembly.id} />
            </div>

            {compareAssembly && (
              <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                <div className="border-b border-stone-100 px-3 py-2 font-mono text-[11px] text-stone-500">
                  เทียบกับ: {compareAssembly.id}
                </div>
                <AssemblyHost id={compareAssembly.id} />
              </div>
            )}

          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Link href="/admin/ui-gallery" className="text-[11px] text-stone-500 underline">
        ← กลับไป UI Gallery
      </Link>
      <h1 className="mt-1 text-xl font-bold text-stone-900">UI Lab</h1>
      <p className="mt-1 text-xs text-stone-500">
        ทดลอง UI จริง: เลือกกลุ่ม → เลือก UI → ปรับ props ที่ component ต้นทางประกาศไว้จริง
        (component → import จริง · route → iframe same-origin) ไม่มีสำเนา ไม่มี mock
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-stone-900 bg-stone-900 px-3 py-1.5 text-xs text-white"
        >
          UI เดี่ยว (inventory)
        </button>
        <button
          type="button"
          onClick={() => setMode("assembly")}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-400"
        >
          🧩 ประกอบหน้าจอ (Assembly)
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {LAB_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => { setGroupId(g.id); setItemId(null); }}
            className={
              "text-xs rounded-lg border px-3 py-1.5 transition-colors " +
              (groupId === g.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-600 hover:border-stone-400")
            }
          >
            {g.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-stone-500">{group.hint}</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-stone-400">เลือก UI ในกลุ่ม {group.label}</div>
            <div className="mt-2 space-y-1 max-h-[280px] overflow-y-auto">
              {groupItems.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setItemId(i.id)}
                  className={
                    "w-full text-left rounded-lg border px-3 py-2 text-[11px] transition-colors " +
                    (item?.id === i.id ? "border-stone-900 bg-stone-50" : "border-stone-200 hover:bg-stone-50")
                  }
                >
                  <div className="font-medium text-stone-800">{i.label}</div>
                  <div className="font-mono text-[9px] text-stone-400 break-all">{i.path}</div>
                </button>
              ))}
              {groupItems.length === 0 && <p className="text-[11px] text-stone-400">ไม่มี UI ในกลุ่มนี้</p>}
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wide text-stone-400">ทดลอง props (ของ component จริง)</div>
              <button type="button" onClick={resetProps} className="text-[10px] rounded-md border border-stone-300 px-2 py-1 text-stone-600 hover:bg-stone-50">
                คืนค่าเริ่มต้น
              </button>
            </div>

            {showRailControl && (
              <div>
                <div className="text-[11px] text-stone-600 mb-1">railItems (จาก resolveNavItems จริง)</div>
                <div className="space-y-1">
                  {REAL_RAIL_ITEMS.map((r) => (
                    <label key={r.key} className="flex items-center gap-2 text-[11px] text-stone-600">
                      <input
                        type="checkbox"
                        checked={railKeys.includes(r.key)}
                        onChange={(e) => setRailKeys((prev) => (e.target.checked ? [...prev, r.key] : prev.filter((k) => k !== r.key)))}
                      />
                      {r.label} <span className="text-stone-400">({r.href})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {showThemeControl && (
              <div>
                <div className="text-[11px] text-stone-600 mb-1">theme (prop จริงของ WorkspaceShell)</div>
                <div className="flex gap-1">
                  {(["dark", "light"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTheme(t)}
                      className={"flex-1 text-[11px] rounded-md border px-2 py-1 " + (theme === t ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 text-stone-600")}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showBoardControl && (
              <div>
                <div className="text-[11px] text-stone-600 mb-1">boardType (core/workspace/boardRouter.ts)</div>
                <div className="flex flex-wrap gap-1">
                  {BOARD_TYPES.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBoardType(b)}
                      className={"text-[11px] rounded-md border px-2 py-1 " + (boardType === b ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 text-stone-600")}
                    >
                      {b}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-stone-400">dashboard → DashboardBoard · อื่น ๆ → NotImplementedBoard</p>
              </div>
            )}

            {showListControl && (
              <label className="flex items-center gap-2 text-[11px] text-stone-600">
                <input type="checkbox" checked={listCollapsible} onChange={(e) => setListCollapsible(e.target.checked)} />
                collapsible (prop จริงของ ListColumn)
              </label>
            )}

            {showCanvasControl && (
              <button
                type="button"
                onClick={() => setNonce((n) => n + 1)}
                className="w-full text-[11px] rounded-md border border-stone-300 px-2 py-1 text-stone-600 hover:bg-stone-50"
              >
                สร้าง layout ใหม่ (workspaceLayoutStore.createEmpty)
              </button>
            )}

            {!showRailControl && !showThemeControl && !showBoardControl && !showListControl && !showCanvasControl && (
              <p className="text-[11px] text-stone-400">UI นี้ไม่มี prop ที่ปรับได้จาก LAB (โฮสต์ป้อน props ว่างให้อยู่แล้ว)</p>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-1">props ที่ส่งเข้า component จริง</div>
              <pre className="text-[10px] bg-stone-50 border border-stone-200 rounded-lg p-2 overflow-x-auto">{JSON.stringify(hostProps, null, 2)}</pre>
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-3">
          {item ? (
            <>
              <div className="rounded-xl border border-stone-200 bg-white p-3">
                <div className="text-sm font-semibold text-stone-800">{item.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-stone-400 break-all">{item.path}</div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-stone-500">{item.category}</span>
                  <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-stone-500">{item.renderMode}</span>
                  {item.branch === "branch" && (
                    <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-purple-700">branch-only</span>
                  )}
                  {item.needsRealData && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">ต้องมีข้อมูลจริง</span>
                  )}
                </div>
                {item.notes && <p className="mt-1 text-[11px] text-stone-500">{item.notes}</p>}
              </div>

              {item.renderMode === "route" && item.route ? (
                <div className="rounded-xl border border-stone-200 overflow-hidden bg-white">
                  <div className="border-b border-stone-100 px-3 py-2 font-mono text-[11px] text-stone-500">
                    iframe → {item.route}
                  </div>
                  <iframe
                    src={item.route}
                    title={`lab ${item.route}`}
                    className="border-0 bg-white w-full"
                    style={{ height: "calc(100vh - 24rem)", minHeight: 420 }}
                  />
                </div>
              ) : item.renderMode === "component" && hostOk ? (
                <div key={nonce}>{renderHost(item.hostKey, hostProps)}</div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                  <div className="text-sm font-semibold text-amber-800">ทดลองใน LAB ไม่ได้</div>
                  <p className="mt-2 text-xs text-amber-800">
                    {item.renderMode === "component"
                      ? `hostKey "${item.hostKey ?? "-"}" ไม่อยู่ใน _lib/componentHost.tsx (HOST_KEYS)`
                      : item.blockedReason ?? "ไม่มีเหตุผลระบุ"}
                  </p>
                  <Link
                    href={`/admin/ui-gallery/preview?id=${item.id}`}
                    className="mt-3 inline-block text-xs rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-amber-800 hover:bg-amber-100"
                  >
                    เปิด preview ของ UI นี้
                  </Link>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-stone-400">เลือก UI ในกลุ่มนี้ก่อน</p>
          )}
        </main>
      </div>
    </div>
  );
}
