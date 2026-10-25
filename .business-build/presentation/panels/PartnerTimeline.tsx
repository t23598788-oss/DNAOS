"use client";

/**
 * Partner timeline/summary — สกัดออกจาก app/admin/partners/[id]/page.tsx
 * (owner spec §8 REUSE — "ONE IMPLEMENTATION · TWO CONSUMERS": เดิมใช้ที่หน้า
 * คู่ค้า · ตอนนี้ WorkspaceFrame ใช้ renderer ตัวเดียวกันสำหรับ timeline
 * result ของ chat — ย้ายมาทั้งก้อน ไม่ใช่คัดลอก)
 */
import NextLink from "next/link";
import type { PartnerTimelineEntry, PartnerSummary } from "@/core/shared/types";
import { EVENT_STYLE } from "@/engines/presentation/event-style";

function formatMoney(n: number | null) {
  if (n == null || n === 0) return null;
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function groupByMonth(entries: PartnerTimelineEntry[]) {
  const groups: { monthKey: string; label: string; entries: PartnerTimelineEntry[] }[] = [];
  for (const entry of entries) {
    const monthKey = entry.date.slice(0, 7);
    const existing = groups.find((g) => g.monthKey === monthKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      const d = new Date(entry.date + "T00:00:00");
      const label = d.toLocaleDateString("th-TH", { year: "numeric", month: "long" });
      groups.push({ monthKey, label, entries: [entry] });
    }
  }
  return groups;
}

const STATUS_COLOR: Record<string, string> = {
  "ร่าง": "bg-amber-100 text-amber-700",
  "บันทึกแล้ว": "bg-stone-100 text-stone-600",
  "ยืนยันแล้ว": "bg-emerald-100 text-emerald-700",
  "ชำระแล้ว": "bg-emerald-100 text-emerald-700",
  "ยกเลิก": "bg-red-100 text-red-600",
};

function EventDot({ eventType }: { eventType: string }) {
  const style = EVENT_STYLE[eventType] ?? { bg: "bg-stone-100", text: "text-stone-500", icon: "•" };
  return (
    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${style.bg}`}>
      {style.icon}
    </span>
  );
}

export function PartnerSummaryCard({ summary: s }: { summary: PartnerSummary }) {
  return (
    <div className="bg-white border border-stone-200 rounded-2xl px-5 py-4 mb-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-bold text-stone-800 text-base">{s.name}</div>
          <div className="text-xs text-stone-400 mt-0.5 space-x-2">
            {s.partner_type_label && <span>{s.partner_type_label}</span>}
            {s.phone && <span>· {s.phone}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <NextLink
            href={`/admin/create-document?partnerId=${s.id}&type=receipt`}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition"
          >
            + สร้างใบเสร็จ
          </NextLink>
          <NextLink
            href={`/admin/create-document?partnerId=${s.id}&type=invoice`}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50 transition"
          >
            + สร้างใบแจ้งหนี้
          </NextLink>
          <NextLink
            href={`/admin/create-document?partnerId=${s.id}`}
            className="text-xs text-stone-400 hover:text-stone-600 transition"
          >
            เอกสารอื่น →
          </NextLink>
        </div>
        <div className="flex gap-4 text-right flex-wrap">
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider">ยอดแจ้งหนี้</div>
            <div className="font-bold text-stone-700 tabular-nums">
              {formatMoney(s.total_invoiced) ? `฿${formatMoney(s.total_invoiced)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider">รับแล้ว</div>
            <div className="font-bold text-emerald-700 tabular-nums">
              {formatMoney(s.total_received) ? `฿${formatMoney(s.total_received)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider">คงเหลือ</div>
            <div className={`font-bold tabular-nums ${s.outstanding > 0 ? "text-rose-600" : "text-stone-400"}`}>
              {formatMoney(s.outstanding) ? `฿${formatMoney(s.outstanding)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider">เอกสาร</div>
            <div className="font-bold text-stone-500">{s.document_count} ใบ</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineEntry({ entry }: { entry: PartnerTimelineEntry }) {
  const style = EVENT_STYLE[entry.event_type] ?? { bg: "bg-stone-100", text: "text-stone-500", icon: "•" };

  return (
    <div className="flex gap-3 group">
      <div className="flex flex-col items-center">
        <EventDot eventType={entry.event_type} />
        <div className="w-px flex-1 bg-stone-200 mt-1 group-last:hidden" />
      </div>

      <div className="pb-5 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            {entry.document_id ? (
              <NextLink
                href={`/admin/${entry.event_type === "invoice" ? "invoice" : entry.event_type === "receipt" ? "receipt" : entry.event_type === "delivery_order" ? "delivery-order" : entry.event_type === "purchase_order" ? "purchase-order" : entry.event_type === "payment_voucher" ? "payment-voucher" : entry.event_type === "debt_notice" ? "debt-notice" : "create-document"}`}
                className={`font-semibold text-sm hover:underline ${style.text}`}
              >
                {entry.title}
              </NextLink>
            ) : (
              <span className={`font-semibold text-sm ${style.text}`}>{entry.title}</span>
            )}
            {entry.subtitle && (
              <div className="text-[10px] text-stone-400 mt-0.5">{entry.subtitle}</div>
            )}
            {entry.artifacts && entry.artifacts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {entry.artifacts.map((artifact) => (
                  <span
                    key={artifact.document_id}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded border border-stone-200 bg-white text-stone-500"
                  >
                    {artifact.document_type} {artifact.document_number}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {entry.amount != null && entry.amount !== 0 && (
              <span className="text-sm font-semibold text-stone-700 tabular-nums">
                ฿{entry.amount.toLocaleString("th-TH")}
              </span>
            )}
            {entry.status && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[entry.status] ?? "bg-stone-100 text-stone-500"}`}>
                {entry.status}
              </span>
            )}
          </div>
        </div>
        <div className="text-[10px] text-stone-400 mt-1">{fmtDate(entry.date)}</div>
      </div>
    </div>
  );
}

/** timeline list เดิม — group ตามเดือน-ปี + empty state เดิม */
export function PartnerTimelineList({ items }: { items: PartnerTimelineEntry[] }) {
  const groups = groupByMonth(items);
  return (
    <div>
      {items.length === 0 && (
        <div className="text-center text-sm text-stone-400 py-10">
          ยังไม่มีเหตุการณ์หรือเอกสารสำหรับคู่ค้านี้
        </div>
      )}
      {groups.map((group) => (
        <div key={group.monthKey} className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-xs font-bold text-stone-500 uppercase tracking-wider">{group.label}</div>
            <div className="flex-1 h-px bg-stone-200" />
            <div className="text-[10px] text-stone-400">{group.entries.length} เหตุการณ์</div>
          </div>
          <div>
            {group.entries.map((entry, i) => (
              <TimelineEntry
                key={entry.template_key ?? entry.document_id ?? entry.business_event_id ?? i}
                entry={entry}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
