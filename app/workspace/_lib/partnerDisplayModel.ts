/**
 * BUSINESS WORKSPACE — Company/Partner master → BusinessDisplayModel (SLICE-1)
 *
 * REWIRE, not a new system. This file only SHAPES what the EXISTING canonical
 * query already returns — services/supabase/queries.ts#getPartnersWithDocumentSummary()
 * (companies master + canonical outstanding computed from invoice_payment_summary
 * and payment_allocations, payment_basis="payment_allocations"; the same values
 * app/admin/partners/page.tsx already shows). No business logic, no new finance
 * formula, no fetch, no write, no new table.
 *
 * Display primitives used are the existing ones declared in
 * app/admin/ui-gallery/_lib/businessDisplayModel.ts:
 *   tree / lines → clickable rows (id → right-side tab)
 *   table        → DataTable (presentation/table/DataTable.tsx)
 *   fields       → Inspector (presentation/panels/Inspector.tsx)
 *
 * Consumer: app/workspace/page.tsx — the ONLY caller. It is a server component
 * and passes the returned plain objects to BusinessWorkspace as props. Never
 * import this from a client component (the query layer is server-only).
 */
import { getPartnersWithDocumentSummary } from "@/services/supabase/queries";
import type { BusinessDisplayModel, FieldRow } from "@/app/admin/ui-gallery/_lib/businessDisplayModel";
import type { OpenTarget } from "./businessTools";

type PartnerSummaryRow = Awaited<ReturnType<typeof getPartnersWithDocumentSummary>>[number];

export const PARTNER_TABLE_TARGET_ID = "partners-table";
const partnerTargetId = (id: string) => `partner:${id}`;

/** Presentation formatting only — identical convention to app/admin/partners/page.tsx. */
const baht = (n: number) => (n === 0 ? "—" : `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`);
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" }) : "—";

/** Same ordering rule the existing admin partners screen already applies. */
function sortedByActivity(rows: PartnerSummaryRow[]): PartnerSummaryRow[] {
  return [...rows].sort((a, b) => {
    if (!a.last_activity && !b.last_activity) return a.name.localeCompare(b.name, "th");
    if (!a.last_activity) return 1;
    if (!b.last_activity) return -1;
    return a.last_activity < b.last_activity ? 1 : -1;
  });
}

function row(label: string, value: string, tone?: FieldRow["tone"]): FieldRow {
  return { kind: "field", id: `pf-${label}`, label, value, ...(tone ? { tone } : {}) };
}

export function buildPartnerListModel(rows: PartnerSummaryRow[]): BusinessDisplayModel {
  const sorted = sortedByActivity(rows);
  const outstanding = Math.round(sorted.reduce((sum, p) => sum + p.outstanding, 0) * 100) / 100;

  const summary = {
    kind: "lines" as const,
    id: "p-summary",
    items: [
      { kind: "text" as const, id: "p-count", text: `คู่ค้าทั้งหมด ${sorted.length} ราย` },
      {
        kind: "text" as const,
        id: "p-outstanding",
        text: `คงเหลือรวม ${baht(outstanding)}`,
        ...(outstanding > 0 ? { tone: "warning" as const } : { tone: "muted" as const }),
      },
      {
        kind: "text" as const,
        id: "p-source",
        text: "companies + invoice_payment_summary − payment_allocations",
        tone: "muted" as const,
      },
    ],
  };

  if (sorted.length === 0) {
    return {
      id: "left-people-live",
      title: "บุคคล / คู่ค้า",
      domain: "Business Data · companies (ว่าง)",
      blocks: [
        summary,
        { kind: "lines", id: "p-empty", items: [{ kind: "text", id: "p-empty-1", text: "ยังไม่มีคู่ค้าในระบบ" }] },
      ],
    };
  }

  return {
    id: "left-people-live",
    title: "บุคคล / คู่ค้า",
    domain: "Business Data · canonical outstanding",
    blocks: [
      summary,
      {
        kind: "tree",
        id: "p-list",
        title: "รายชื่อ (กดเพื่อเปิด)",
        items: sorted.map((p) => ({
          kind: "tree" as const,
          id: partnerTargetId(p.id),
          label: p.name || p.id,
          depth: 0,
          ...(p.document_count > 0 ? { badge: p.document_count } : {}),
          ...(p.outstanding > 0 ? { tone: "warning" as const } : { tone: "muted" as const }),
        })),
      },
    ],
  };
}

export function buildPartnerTargets(rows: PartnerSummaryRow[]): Record<string, OpenTarget> {
  const sorted = sortedByActivity(rows);

  const targets: Record<string, OpenTarget> = {
    [PARTNER_TABLE_TARGET_ID]: {
      id: PARTNER_TABLE_TARGET_ID,
      title: "ตารางคู่ค้า",
      model: {
        id: "right-partners-table",
        title: "คู่ค้า",
        domain: "Table → DataTable · canonical outstanding",
        blocks: [
          {
            kind: "table",
            id: "p-table",
            columns: [
              { key: "name", label: "ชื่อ" },
              { key: "type", label: "ประเภท" },
              { key: "invoiced", label: "ยอดแจ้งหนี้" },
              { key: "received", label: "รับแล้ว" },
              { key: "outstanding", label: "คงเหลือ" },
              { key: "docs", label: "เอกสาร" },
            ],
            rows: sorted.map((p) => [
              p.name || p.id,
              p.partner_type_label || "—",
              baht(p.total_invoiced),
              baht(p.total_received),
              baht(p.outstanding),
              String(p.document_count),
            ]),
          },
        ],
      },
    },
  };

  for (const p of sorted) {
    targets[partnerTargetId(p.id)] = {
      id: partnerTargetId(p.id),
      title: p.name || p.id,
      model: {
        id: `right-${partnerTargetId(p.id)}`,
        title: p.name || p.id,
        domain: "Row → Inspector · companies + canonical outstanding",
        blocks: [
          {
            kind: "fields",
            id: "p-detail",
            title: "ข้อมูลคู่ค้า",
            fields: [
              row("ชื่อ", p.name || "—"),
              row("รหัส", p.code || "—"),
              row("ประเภท", p.partner_type_label || "—"),
              row("โทร", p.phone || "—"),
              row("อีเมล", p.contact_name || "—"),
              row("เลขผู้เสียภาษี", p.tax_id || "—"),
              row("ที่อยู่", p.address || "—"),
              row("ยอดแจ้งหนี้", baht(p.total_invoiced)),
              row("รับแล้ว", baht(p.total_received)),
              row("คงเหลือ", baht(p.outstanding), p.outstanding > 0 ? "warning" : undefined),
              row("เอกสาร", `${p.document_count} ใบ`),
              row("กิจกรรมล่าสุด", fmtDate(p.last_activity)),
            ],
          },
        ],
      },
    };
  }

  return targets;
}

/**
 * The whole Business-Data read for the workspace in ONE place: run the existing
 * canonical query once, then shape it. Callers pass the result down as plain
 * props — they never see the query layer.
 */
export async function loadPartnerWorkspace(): Promise<{
  rowCount: number;
  listModel: BusinessDisplayModel;
  targets: Record<string, OpenTarget>;
}> {
  const rows = await getPartnersWithDocumentSummary();
  return {
    rowCount: rows.length,
    listModel: buildPartnerListModel(rows),
    targets: buildPartnerTargets(rows),
  };
}
