"use client";

import { useEffect, useState } from "react";

/**
 * กล่องรับเข้า — ขวาบนของ Workspace (handoff workspace-reference.html:
 * "กล่องรับเข้าอยู่ขวาบน แยกข้อความและเหตุการณ์ภายใน; ตัวเลขต้องมาจาก
 * ข้อมูลจริง"). Floating edge control, NOT a top bar (รูปแบบที่ต้องรักษา:
 * Workspace โล่ง ไม่มีแถบบน).
 *
 * Real sources only — same admin-tier APIs (core/auth/session) the existing
 * screens use:
 *   ข้อความ     = /api/admin/outbound-drafts ที่ status=pending_review
 *                 (Rule-72 queue — ตัวเลขเดียวกับ badge ฝั่งเลขา/relationships)
 *   เหตุการณ์   = /api/admin/event-inbox        (business_events ทั้งหมด)
 * Fail-soft: source down → row shows "—"; whole box hidden when NO source
 * answers — never a mocked0. Rendered only when the caller already holds the
 * chat capability (BusinessWorkspace gates on allowedTools — capability
 * authority, not a role name).
 */
interface DraftRow {
  status: string;
}
interface Counts {
  drafts: number | null;
  events: number | null;
}

export default function InboxIndicator() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [draftsRes, eventsRes] = await Promise.all([
        fetch("/api/admin/outbound-drafts", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/admin/event-inbox", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      if (!draftsRes && !eventsRes) {
        setCounts(null); // ไม่มีแหล่งข้อมูลไหนตอบ → ไม่แสดงเลย (ไม่เดาตัวเลข)
        return;
      }
      setCounts({
        drafts: draftsRes ? (draftsRes.drafts as DraftRow[]).filter((d) => d.status === "pending_review").length : null,
        events: eventsRes ? (eventsRes.events as unknown[]).length : null,
      });
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!counts) return null;

  return (
    <div className="fixed right-3 top-3 z-40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="กล่องรับเข้า"
        className="flex items-center gap-2 rounded-full border border-[#E9E1D6] bg-[#FDFBF8] px-3 py-1.5 text-xs shadow-sm hover:border-[#D5C8B6]"
      >
        <span className="font-semibold text-stone-700">กล่องรับเข้า</span>
        <span className="rounded-full bg-rose-50 border border-rose-200 px-1.5 text-[10px] font-semibold text-rose-700">
          ข้อความ {counts.drafts ?? "—"}
        </span>
        <span className="rounded-full bg-emerald-50 border border-emerald-200 px-1.5 text-[10px] font-semibold text-emerald-700">
          เหตุการณ์ {counts.events ?? "—"}
        </span>
      </button>
      {open && (
        <div className="mt-1 w-64 rounded-xl border border-[#E9E1D6] bg-[#FDFBF8] p-2 shadow-lg">
          <a
            href="/admin/relationships"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-lg px-2 py-2 text-xs text-stone-700 hover:bg-[#F7F4EF]"
          >
            <span>ข้อความรอตรวจสอบ (Rule 72)</span>
            <span className="font-semibold">{counts.drafts ?? "—"}</span>
          </a>
          <a
            href="/admin/event-inbox"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-lg px-2 py-2 text-xs text-stone-700 hover:bg-[#F7F4EF]"
          >
            <span>เหตุการณ์ทั้งหมด</span>
            <span className="font-semibold">{counts.events ?? "—"}</span>
          </a>
        </div>
      )}
    </div>
  );
}