import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { activeOrganizationClaim, resolveBusinessOrganizationScope } from "@/app/api/business/_lib/workspace";
import { supabaseAdmin } from "@/services/supabase/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const LIMIT = 100;
const KINDS = new Set(["all", "messages", "events", "parties", "orders", "documents", "finance", "logistics"]);

function dateInRange(value: unknown, from: string, to: string): boolean {
  const date = typeof value === "string" ? value.slice(0, 10) : "";
  return (!from || date >= from) && (!to || date <= to);
}

export async function GET(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const organizationId = activeOrganizationClaim(req);
  const checked = await resolveBusinessOrganizationScope(user, organizationId);
  if (!checked.allowed) {
    return NextResponse.json({ ok: false, code: "BUSINESS_ORGANIZATION_SELECTION_REQUIRED", reason: checked.reason }, { status: 409, headers: NO_STORE });
  }

  const params = req.nextUrl.searchParams;
  const requestedCompanyId = params.get("company_id");
  const requestedKind = params.get("kind") ?? "all";
  const kind = KINDS.has(requestedKind) ? requestedKind : "all";
  const status = (params.get("status") ?? "").trim().toLowerCase();
  const query = (params.get("q") ?? "").trim().toLowerCase();
  const from = params.get("date_from") ?? "";
  const to = params.get("date_to") ?? "";
  const db = supabaseAdmin();

  let companyQuery = db.from("companies").select("id, name, type, organization_id").eq("organization_id", organizationId).order("name");
  if (requestedCompanyId) companyQuery = companyQuery.eq("id", requestedCompanyId);
  const { data: companies, error: companyError } = await companyQuery.limit(500);
  if (companyError) return NextResponse.json({ ok: false, code: "BUSINESS_COMPANIES_READ_FAILED" }, { status: 500, headers: NO_STORE });
  const companyIds = (companies ?? []).map((company: { id: string }) => company.id);
  if (requestedCompanyId && !companyIds.includes(requestedCompanyId)) {
    return NextResponse.json({ ok: false, code: "COMPANY_OUTSIDE_ACTIVE_ORGANIZATION" }, { status: 404, headers: NO_STORE });
  }
  if (!companyIds.length) return NextResponse.json({ ok: true, organization_id: organizationId, companies: [], items: [], total: 0 }, { headers: NO_STORE });

  // Use the provider-neutral identity registry; company_line_links is retired
  // and guarded against writes in the checked-in schema snapshot.
  const { data: links, error: linkError } = await db.from("connect_external_identities").select("id, company_id, external_subject_id").eq("provider", "line").in("company_id", companyIds);
  if (linkError) return NextResponse.json({ ok: false, code: "BUSINESS_CHANNEL_LINKS_READ_FAILED" }, { status: 500, headers: NO_STORE });
  const lineUserIds = [...new Set((links ?? []).map((link: { external_subject_id: string }) => link.external_subject_id).filter(Boolean))];

  const [messagesRes, eventsByCompanyRes, eventsByLineRes, ordersRes, invoicesRes, standaloneRes, receiptsRes, debtRes] = await Promise.all([
    lineUserIds.length && (kind === "all" || kind === "messages" || kind === "events")
      ? db.from("line_events").select("id, line_user_id, raw_type, raw_text, direction, status, created_at").in("line_user_id", lineUserIds).order("created_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    kind === "all" || kind === "events"
      ? db.from("business_events").select("id, event_code, event_type_code, event_type, status, created_at, source_message_ids, transaction_id, partner_id, source_line_user_id").in("partner_id", companyIds).order("created_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    lineUserIds.length && (kind === "all" || kind === "events")
      ? db.from("business_events").select("id, event_code, event_type_code, event_type, status, created_at, source_message_ids, transaction_id, partner_id, source_line_user_id").in("source_line_user_id", lineUserIds).order("created_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    kind === "all" || kind === "orders" || kind === "logistics"
      ? db.from("customer_orders").select("id, order_no, status, tx_type, customer_company_id, requested_delivery_at, created_at, updated_at").in("customer_company_id", companyIds).order("updated_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    kind === "all" || kind === "documents" || kind === "finance"
      ? db.from("invoices").select("id, invoice_no, invoice_status, customer_company_id, customer_order_id, total_amount, invoice_date, due_date, created_at").in("customer_company_id", companyIds).order("created_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    kind === "all" || kind === "documents" || kind === "logistics"
      ? db.from("standalone_documents").select("id, document_no, document_type, status, customer_company_id, customer_order_id, total_amount, document_date, created_at").in("customer_company_id", companyIds).order("created_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    kind === "all" || kind === "finance" || kind === "documents"
      ? db.from("receipt_documents").select("id, document_type, status, customer_company_id, line_event_id, amount, document_date, source_channel, reference_number, media_path, verification_level, created_at").in("customer_company_id", companyIds).order("created_at", { ascending: false }).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    kind === "all" || kind === "finance"
      ? db.from("company_debt_current").select("company_id, ledger_outstanding, snapshot_collection_state, snapshot_days_overdue, last_event_at").in("company_id", companyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const failed = [messagesRes.error, eventsByCompanyRes.error, eventsByLineRes.error, ordersRes.error, invoicesRes.error, standaloneRes.error, receiptsRes.error, debtRes.error].some(Boolean);
  if (failed) return NextResponse.json({ ok: false, code: "BUSINESS_WORKSPACE_READ_FAILED" }, { status: 500, headers: NO_STORE });

  const invoiceIds = (invoicesRes.data ?? []).map((row: { id: string }) => row.id);
  const standaloneIds = (standaloneRes.data ?? []).map((row: { id: string }) => row.id);
  const allocationQueries = await Promise.all([
    invoiceIds.length && (kind === "all" || kind === "finance")
      ? db.from("payment_allocations").select("id, receipt_document_id, invoice_id, standalone_document_id, debt_event_id, amount, allocation_kind, allocated_at").in("invoice_id", invoiceIds).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    standaloneIds.length && (kind === "all" || kind === "finance")
      ? db.from("payment_allocations").select("id, receipt_document_id, invoice_id, standalone_document_id, debt_event_id, amount, allocation_kind, allocated_at").in("standalone_document_id", standaloneIds).limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (allocationQueries.some((result) => result.error)) {
    return NextResponse.json({ ok: false, code: "BUSINESS_PAYMENT_LINKS_READ_FAILED" }, { status: 500, headers: NO_STORE });
  }
  const allocationRows = new Map<string, Record<string, unknown>>();
  for (const row of [...(allocationQueries[0].data ?? []), ...(allocationQueries[1].data ?? [])] as Array<Record<string, unknown>>) {
    allocationRows.set(String(row.id), row);
  }

  const companyName = new Map((companies ?? []).map((company: { id: string; name: string }) => [company.id, company.name]));
  const documentCompany = new Map<string, string>();
  for (const row of [...(invoicesRes.data ?? []), ...(standaloneRes.data ?? [])] as Array<Record<string, unknown>>) {
    if (typeof row.id === "string" && typeof row.customer_company_id === "string") documentCompany.set(row.id, row.customer_company_id);
  }
  const lineCompany = new Map((links ?? []).map((link: { external_subject_id: string; company_id: string }) => [link.external_subject_id, link.company_id]));
  const lineIdentity = new Map((links ?? []).map((link: { id: string; external_subject_id: string }) => [link.external_subject_id, link.id]));
  const businessEvents = new Map<string, Record<string, unknown>>();
  for (const row of [...(eventsByCompanyRes.data ?? []), ...(eventsByLineRes.data ?? [])] as Array<Record<string, unknown>>) {
    businessEvents.set(String(row.id), row);
  }
  const normalizedItems: Array<{
    kind: string; source_table: string; source_id: unknown; occurred_at: unknown;
    status: unknown; company_id: unknown; company_name: string | null; title: unknown;
    detail: unknown; reference_id: unknown; related_ids?: unknown[]; logistics_reference?: unknown;
  }> = [
    ...(messagesRes.data ?? []).map((row: Record<string, unknown>) => ({ kind: "message", source_table: "line_events", source_id: row.id, occurred_at: row.created_at, status: row.status, company_id: lineCompany.get(String(row.line_user_id)) ?? null, company_name: companyName.get(String(lineCompany.get(String(row.line_user_id)))) ?? null, title: row.raw_type ?? "ข้อความ", detail: row.raw_text ?? null, reference_id: row.id, related_ids: row.line_user_id && lineIdentity.get(String(row.line_user_id)) ? [lineIdentity.get(String(row.line_user_id))] : [] })),
    ...[...businessEvents.values()].map((row) => ({ kind: "event", source_table: "business_events", source_id: row.id, occurred_at: row.created_at, status: row.status, company_id: row.partner_id ?? (row.source_line_user_id ? lineCompany.get(String(row.source_line_user_id)) ?? null : null), company_name: companyName.get(String(row.partner_id ?? (row.source_line_user_id ? lineCompany.get(String(row.source_line_user_id)) : ""))) ?? null, title: row.event_code ?? row.event_type_code ?? row.event_type ?? "เหตุการณ์ธุรกิจ", detail: row.source_message_ids ?? null, reference_id: row.transaction_id ?? row.id })),
    ...(ordersRes.data ?? []).map((row: Record<string, unknown>) => ({ kind: "order", source_table: "customer_orders", source_id: row.id, occurred_at: row.updated_at ?? row.created_at, status: row.status, company_id: row.customer_company_id, company_name: companyName.get(String(row.customer_company_id)) ?? null, title: row.order_no ?? "คำสั่งซื้อ", detail: row.tx_type ?? null, reference_id: row.id, logistics_reference: row.requested_delivery_at ?? null })),
    ...(invoicesRes.data ?? []).map((row: Record<string, unknown>) => ({ kind: "document", source_table: "invoices", source_id: row.id, occurred_at: row.invoice_date ?? row.created_at, status: row.invoice_status, company_id: row.customer_company_id, company_name: companyName.get(String(row.customer_company_id)) ?? null, title: row.invoice_no ?? "ใบแจ้งหนี้", detail: row.total_amount ?? null, reference_id: row.customer_order_id ?? row.id })),
    ...(standaloneRes.data ?? []).map((row: Record<string, unknown>) => ({ kind: row.document_type === "delivery_order" ? "logistics" : "document", source_table: "standalone_documents", source_id: row.id, occurred_at: row.document_date ?? row.created_at, status: row.status, company_id: row.customer_company_id, company_name: companyName.get(String(row.customer_company_id)) ?? null, title: row.document_no ?? row.document_type ?? "เอกสาร", detail: row.total_amount ?? null, reference_id: row.customer_order_id ?? row.id })),
    ...(receiptsRes.data ?? []).map((row: Record<string, unknown>) => ({ kind: "finance", source_table: "receipt_documents", source_id: row.id, occurred_at: row.document_date ?? row.created_at, status: row.status, company_id: row.customer_company_id, company_name: companyName.get(String(row.customer_company_id)) ?? null, title: row.document_type ?? "หลักฐานรับเงิน", detail: { amount: row.amount, source_channel: row.source_channel, has_source_file: Boolean(row.media_path), verification_level: row.verification_level }, reference_id: row.line_event_id ?? row.id })),
    ...[...allocationRows.values()].map((row) => {
      const documentId = typeof row.invoice_id === "string" ? row.invoice_id : typeof row.standalone_document_id === "string" ? row.standalone_document_id : null;
      const companyId = documentId ? documentCompany.get(documentId) ?? null : null;
      return { kind: "finance", source_table: "payment_allocations", source_id: row.id, occurred_at: row.allocated_at, status: row.allocation_kind, company_id: companyId, company_name: companyId ? companyName.get(companyId) ?? null : null, title: "การจัดสรรหลักฐานรับเงิน", detail: row.amount ?? null, reference_id: row.receipt_document_id, related_ids: [row.invoice_id, row.standalone_document_id, row.debt_event_id].filter(Boolean) };
    }),
    ...(debtRes.data ?? []).map((row: Record<string, unknown>) => ({ kind: "finance", source_table: "company_debt_current", source_id: row.company_id, occurred_at: row.last_event_at, status: row.snapshot_collection_state, company_id: row.company_id, company_name: companyName.get(String(row.company_id)) ?? null, title: "ยอดลูกหนี้คงเหลือ", detail: row.ledger_outstanding ?? null, reference_id: row.company_id })),
  ];
  const items = normalizedItems.filter((item) => kind === "all" || (kind === "events" ? item.kind === "event" || item.kind === "message" : item.kind === kind || (kind === "documents" && (item.kind === "document" || item.source_table === "receipt_documents")) || (kind === "orders" && item.kind === "order") || (kind === "logistics" && (item.kind === "logistics" || (item.kind === "order" && Boolean(item.logistics_reference)))) || (kind === "finance" && item.kind === "finance")))
    .filter((item) => !status || String(item.status ?? "").toLowerCase().includes(status))
    .filter((item) => !query || `${item.title} ${item.detail ?? ""} ${item.company_name ?? ""} ${item.source_id}`.toLowerCase().includes(query))
    .filter((item) => dateInRange(item.occurred_at, from, to))
    .sort((a, b) => String(b.occurred_at ?? "").localeCompare(String(a.occurred_at ?? "")))
    .slice(0, LIMIT);

  return NextResponse.json({ ok: true, organization_id: organizationId, companies, items, total: items.length, limit: LIMIT }, { headers: NO_STORE });
}
