/**
 * BUSINESS WORKSPACE — JOB list → BusinessDisplayModel (SLICE-2)
 *
 * REWIRE, not a new system. This file only SHAPES what the EXISTING canonical
 * path already returns:
 *   · services/supabase/queries.ts#getTransactions()          → customer_orders
 *     joined to companies via the existing customer_orders_customer_company_id_fkey
 *   · services/canonical/transaction-list.ts#getTransactionMoneySummaries()
 *     → persisted canonical document_canonical + invoice_payment_summary sums
 *     (nothing is recomputed here — the same two calls
 *      app/api/admin/transactions/route.ts already composes)
 * No job engine, no job store, no job API, no money formula, no fetch of its own.
 *
 * TRACE HONESTY (see the slice report): the old `getJobs()`/`job.list` path
 * queries `transport_jobs`, a table that does not exist (core/workspace/gateway/
 * presentationGateway.ts:158 records the live schema check) — it is NOT used
 * here and no new table was invented. Job↔material (customer_order_items),
 * job↔vehicle (job_vehicle_pricings), job↔equipment and the per-row relation
 * block (project/site/documents via services/canonical/transaction-detail.ts)
 * are DEFERRED, not faked.
 *
 * Consumer: app/workspace/page.tsx — the ONLY caller (server component). Never
 * import this from a client component (the query layer is server-only).
 */
import { getTransactions } from "@/services/supabase/queries";
import { getTransactionMoneySummaries, type TransactionMoneySummary } from "@/services/canonical/transaction-list";
import type { BusinessDisplayModel, FieldRow } from "@/app/admin/ui-gallery/_lib/businessDisplayModel";
import type { OpenTarget } from "./businessTools";

type TransactionRow = Awaited<ReturnType<typeof getTransactions>>[number];

export const JOB_TABLE_TARGET_ID = "jobs-table";
const jobTargetId = (id: string) => `job:${id}`;

/** Presentation formatting only — same convention as the existing screens. */
const baht = (n: number | null) => (n === null || n === 0 ? "—" : `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`);
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" }) : "—";

function row(label: string, value: string, tone?: FieldRow["tone"]): FieldRow {
  return { kind: "field", id: `jf-${label}`, label, value, ...(tone ? { tone } : {}) };
}

/** Canonical money for one job — absent summary means "no canonical document yet". */
function money(moneyByOrder: Map<string, TransactionMoneySummary>, id: string): TransactionMoneySummary | null {
  return moneyByOrder.get(id) ?? null;
}

export function buildJobListModel(
  rows: TransactionRow[],
  moneyByOrder: Map<string, TransactionMoneySummary>,
): BusinessDisplayModel {
  const outstanding = Math.round(
    rows.reduce((sum, r) => sum + (money(moneyByOrder, r.id)?.outstanding ?? 0), 0) * 100,
  ) / 100;
  const documents = rows.reduce((sum, r) => sum + (money(moneyByOrder, r.id)?.document_count ?? 0), 0);

  const summary = {
    kind: "lines" as const,
    id: "j-summary",
    items: [
      { kind: "text" as const, id: "j-count", text: `งาน/คำสั่งซื้อทั้งหมด ${rows.length} รายการ` },
      {
        kind: "text" as const,
        id: "j-outstanding",
        text: `คงเหลือรวม ${baht(outstanding)} · เอกสาร ${documents} ใบ`,
        ...(outstanding > 0 ? { tone: "warning" as const } : { tone: "muted" as const }),
      },
      {
        kind: "text" as const,
        id: "j-source",
        text: "customer_orders + document_canonical − invoice_payment_summary",
        tone: "muted" as const,
      },
    ],
  };

  if (rows.length === 0) {
    return {
      id: "left-jobs-live",
      title: "งาน",
      domain: "JOB · customer_orders (ว่าง)",
      blocks: [
        summary,
        { kind: "lines", id: "j-empty", items: [{ kind: "text", id: "j-empty-1", text: "ยังไม่มีงานในระบบ" }] },
      ],
    };
  }

  return {
    id: "left-jobs-live",
    title: "งาน",
    domain: "JOB · canonical order + money",
    blocks: [
      summary,
      {
        kind: "tree",
        id: "j-list",
        title: "รายการงาน (กดเพื่อเปิด)",
        items: rows.map((r) => {
          const m = money(moneyByOrder, r.id);
          const unpaid = (m?.outstanding ?? 0) > 0;
          return {
            kind: "tree" as const,
            id: jobTargetId(r.id),
            label: `${r.title || r.id}${r.partners?.name ? ` · ${r.partners.name}` : ""}`,
            depth: 0,
            ...(m && m.document_count > 0 ? { badge: m.document_count } : {}),
            ...(unpaid ? { tone: "warning" as const } : { tone: "muted" as const }),
          };
        }),
      },
    ],
  };
}

export function buildJobTargets(
  rows: TransactionRow[],
  moneyByOrder: Map<string, TransactionMoneySummary>,
): Record<string, OpenTarget> {
  const targets: Record<string, OpenTarget> = {
    [JOB_TABLE_TARGET_ID]: {
      id: JOB_TABLE_TARGET_ID,
      title: "ตารางงาน",
      model: {
        id: "right-jobs-table",
        title: "งาน / คำสั่งซื้อ",
        domain: "Table → DataTable · customer_orders + canonical money",
        blocks: [
          {
            kind: "table",
            id: "j-table",
            columns: [
              { key: "order_no", label: "เลขที่งาน" },
              { key: "state", label: "สถานะ" },
              { key: "company", label: "คู่ค้า" },
              { key: "docs", label: "เอกสาร" },
              { key: "gross", label: "ยอดรวม" },
              { key: "paid", label: "รับแล้ว" },
              { key: "outstanding", label: "คงเหลือ" },
            ],
            rows: rows.map((r) => {
              const m = money(moneyByOrder, r.id);
              return [
                r.title || r.id,
                r.state || "—",
                r.partners?.name ?? "—",
                m ? String(m.document_count) : "—",
                baht(m ? m.gross_amount : null),
                baht(m ? m.paid_amount : null),
                baht(m ? m.outstanding : null),
              ];
            }),
          },
        ],
      },
    },
  };

  for (const r of rows) {
    const m = money(moneyByOrder, r.id);
    targets[jobTargetId(r.id)] = {
      id: jobTargetId(r.id),
      title: r.title || r.id,
      model: {
        id: `right-${jobTargetId(r.id)}`,
        title: r.title || r.id,
        domain: "Row → Inspector · customer_orders + canonical money",
        blocks: [
          {
            kind: "fields",
            id: "j-detail",
            title: "ข้อมูลงาน",
            fields: [
              row("เลขที่งาน", r.title || "—"),
              row("สถานะ", r.state || "—"),
              row("คู่ค้า", r.partners?.name ?? "—"),
              row("โทร", r.partners?.phone ?? "—"),
              row("เอกสาร", m ? `${m.document_count} ใบ` : "—"),
              row("ยอดรวม", baht(m ? m.gross_amount : null)),
              row("รับแล้ว", baht(m ? m.paid_amount : null)),
              row("คงเหลือ", baht(m ? m.outstanding : null), m && m.outstanding > 0 ? "warning" : undefined),
              row(
                "ความครบถ้วนข้อมูล",
                m ? m.data_completeness : "—",
                m && m.data_completeness !== "FULL" ? "warning" : undefined,
              ),
              row("สร้างเมื่อ", fmtDate(r.created_at)),
            ],
          },
        ],
      },
    };
  }

  return targets;
}

/**
 * The whole JOB read for the workspace in ONE place: the same two canonical
 * calls the existing transactions API already composes, once per page render.
 */
export async function loadJobWorkspace(): Promise<{
  rowCount: number;
  listModel: BusinessDisplayModel;
  targets: Record<string, OpenTarget>;
}> {
  const rows = await getTransactions();
  const moneyByOrder = await getTransactionMoneySummaries(rows.map((r) => r.id));
  return {
    rowCount: rows.length,
    listModel: buildJobListModel(rows, moneyByOrder),
    targets: buildJobTargets(rows, moneyByOrder),
  };
}
