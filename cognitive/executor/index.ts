/**
 * Cognitive Executor — runs Planner steps through existing V2/V6 runtime modules.
 * ทุก step ที่มี query handler ใน dispatcher จะถูกบังคับใช้กฎจาก command-registry.json
 */

import { previewDocumentCreate } from "@/gateway/actions";
import { dispatch as dispatchCommand, isRegistered } from "@/engines/validation/dispatcher";
import { DOC_LABELS, type DocType } from "@/engines/documents/engine";
import type { CurrentDebt } from "@/engines/debt/tracking";
import { executeCapability } from "@/plugins/capability-manager";
import { execute as executeV6 } from "@/plugins";
import { formatDocumentCreateResult } from "@/presenter/formatter";
import type { ExecutionPlan, ToolStepPlan } from "../planner";
import type { WorldState } from "../state";
import type { ExecutionOutput } from "../evaluation";

type StepData = Record<string, unknown> | Record<string, unknown>[] | null;

interface StepResult extends ExecutionOutput {
  data: StepData;
}

export async function executePlan(plan: ExecutionPlan, worldState: WorldState): Promise<StepResult[]> {
  if (plan.ask_user || plan.steps.length === 0) return [];

  const results: StepResult[] = [];

  for (const step of [...plan.steps].sort((a, b) => a.group - b.group || a.id - b.id)) {
    const started = Date.now();
    try {
      const data = await runStep(step, worldState, results);
      results.push({
        tool: step.tool,
        success: true,
        data,
        duration_ms: Date.now() - started,
      });
      // Rule 72: a *.create step that only produced a preview (no real DB
      // write yet, no document_id) must not flow into document.present /
      // pdf.export / line.send — those steps need a real, saved document.
      // Stop here and let the human confirm before anything downstream runs.
      if ((data as { _preview_pending?: boolean } | null)?._preview_pending) break;
    } catch (error) {
      results.push({
        tool: step.tool,
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - started,
      });
      if (step.on_fail === "abort") break;
    }
  }

  return results;
}

async function runStep(step: ToolStepPlan, worldState: WorldState, results: StepResult[]): Promise<StepData> {
  const args = resolveRuntimeArgs(step.args, results);

  const registryCommand = toRegistryCommand(step.tool);
  if (registryCommand && isRegistered(registryCommand)) {
    const dispatched = await dispatchCommand(registryCommand, args, !step.tool.endsWith(".create"));
    if (!dispatched.ok && dispatched.violations.length > 0) {
      throw new Error(`Rule violation: ${dispatched.violations.join("; ")}`);
    }
    if (dispatched.ok && dispatched.data !== null) {
      return dispatched.data as StepData;
    }
  }

  switch (step.tool) {
    case "identity.resolve":
      return resolveIdentity(args.name ?? worldState.context.who ?? "");
    case "debt.query":
      return queryDebt(args.customer_id, worldState, results);
    case "document.query":
    case "invoice.query":
    case "quotation.query":
    case "boq.query":
      return queryDocuments(args.customer_id, worldState, results, args.document_type);
    case "customer.list":
    case "partner.list":
      return dispatchToData("partner.list", {});
    case "material.list":
      return dispatchToData("material.list", {});
    case "job.query":
      return queryJobs(worldState);
    case "job.list":
      return dispatchToData("job.list", {});
    case "invoice.create":
    case "quotation.create":
    case "boq.create":
    case "receipt.create":
    case "delivery_order.create":
    case "billing.create":
      return executeDocumentCommand(step.tool, args, worldState, results);
    case "document.present":
      return presentDocument(results);
    case "pdf.export":
      return exportPdf(args, results);
    case "line.send":
      return sendLine(args, results);
    case "action.execute":
      return executePendingAction(args.action);
    default:
      throw new Error(`ไม่รองรับ tool: ${step.tool}`);
  }
}

function toRegistryCommand(tool: string): string | null {
  const TOOL_TO_COMMAND: Record<string, string> = {
    "partner.list": "partner.list",
    "customer.list": "partner.list",
    "material.list": "material.list",
    "job.list": "job.list",
    // "debt.query" deliberately NOT mapped to a registry command here — it
    // was previously mapped to "debt.list" (unfiltered, ALL customers'
    // open debts), which shadowed queryDebt()'s real per-customer
    // resolution below and always returned first (found + fixed
    // 2026-07-17). queryDebt() calls the "debt.current" capability
    // (getCurrentDebt) itself, once it has resolved which customer.
  };
  if (tool in TOOL_TO_COMMAND) return TOOL_TO_COMMAND[tool];
  // "document.query"/"invoice.query" deliberately NOT auto-routed here —
  // same shadowing class as the debt.query bug fixed above: the registry
  // command returns ALL documents unfiltered, and would always win before
  // queryDocuments() below ever got to filter by customer (found + fixed
  // 2026-07-17). queryDocuments() calls the right registry command itself,
  // then filters.
  return null;
}

// Small helper so every AI-facing function calls the same dispatcher path
// (owner, 2026-07-17, Architecture Correction) instead of importing
// services/engines directly. Swallows a failed/empty dispatch into an empty
// result rather than throwing, matching the existing behavior of the raw
// calls this replaces.
async function dispatchToData(command: string, payload: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const dispatched = await dispatchCommand(command, payload);
  if (!dispatched.ok || !dispatched.data) return [];
  return Array.isArray(dispatched.data) ? dispatched.data as Record<string, unknown>[] : [dispatched.data as Record<string, unknown>];
}

async function resolveIdentity(name: string): Promise<Record<string, unknown>[]> {
  const query = name.trim();
  if (!query) return [];
  return dispatchToData("partner.find", { keyword: query });
}

async function queryDebt(customerId: string | undefined, worldState: WorldState, results: StepResult[]): Promise<Record<string, unknown>[]> {
  const resolved = resolveCustomer(customerId, worldState, results);
  const customerName = resolved.name ?? worldState.context.who;
  const [debts, docs] = await Promise.all([dispatchToData("debt.list", {}), dispatchToData("document.list", {})]);

  const invoiceDebts = debts
    .map((debt) => {
      const doc = docs.find((d) => d.id === debt.document_id);
      return { ...debt, customer_name: doc?.party_name ?? customerName ?? "" };
    })
    .filter((debt) => matchesCustomer(debt.customer_name, customerName));

  if (invoiceDebts.length > 0) return invoiceDebts;

  // Architecture Correction (owner, 2026-07-17): AI must not choose between
  // debt formulas or even know they exist — it invokes the named capability
  // "debt.current" (GetCurrentDebt(partnerId)) through the same registry-
  // gated dispatcher every other command goes through, not the engine
  // function directly. What runs behind that name (getCurrentDebt() today)
  // is DNA OS's decision, not the AI's. Previously this called calcDebtFull()
  // directly, which throws [CONFIG MISSING] on every real invocation
  // (debt-interest-rate/grace-period-hours/collection-fee-rate/limit do not
  // exist in app_configs) and was silently swallowed by a try/catch that
  // fell back to raw, uninflated principal_amount.
  if (!resolved.id) return [];
  const dispatched = await dispatchCommand("debt.current", { partner_id: resolved.id });
  if (!dispatched.ok || !dispatched.data) return [];
  const debt = dispatched.data as {
    principal: number; interest: number; penalty: number; collection_fee: number;
    total_due: number; overdue_days: number; calculated_at: string;
  };

  return [{
    customer_name: customerName,
    principal_amount: debt.principal,
    interest_amount: debt.interest,
    fee_amount: debt.collection_fee,
    outstanding_amount: debt.total_due,
    total_outstanding: debt.total_due,
    days_overdue: debt.overdue_days,
    calculated_at: debt.calculated_at,
  }];
}

function documentCommandFor(docType?: string): string {
  if (docType === "invoice") return "invoice.list";
  if (docType === "quotation") return "document.boq";
  if (docType === "receipt") return "document.receipt";
  return "document.list";
}

async function queryDocuments(customerId: string | undefined, worldState: WorldState, results: StepResult[], docType?: string): Promise<Record<string, unknown>[]> {
  const resolved = resolveCustomer(customerId, worldState, results);
  const docs = await dispatchToData(documentCommandFor(docType), {});
  return docs.filter((doc) => matchesCustomer(doc.party_name, resolved.name ?? worldState.context.who));
}

async function queryJobs(worldState: WorldState): Promise<Record<string, unknown>[]> {
  const jobs = await dispatchToData("job.list", {});
  return jobs.filter((job) =>
    matchesCustomer(job.contact_name, worldState.context.who) ||
    matchesCustomer(job.project_name, worldState.context.who)
  );
}

const DEBT_DOCUMENT_TYPES = new Set<DocType>(["invoice", "billing", "receipt"]);

interface InvoicePreviewResult {
  status: "OK" | "NO_OUTSTANDING_DEBT" | "PARTNER_NOT_FOUND" | "ERROR";
  reason?: string;
  suggested_actions?: string[];
  document_number?: string;
  html?: string;
  flex_preview?: unknown;
  total?: number;
  items?: unknown;
  debt_summary?: unknown;
  preview_token?: string;
}

// GenerateInvoicePreview(partnerId, documentType?, note?) — owner,
// 2026-07-17, Invoice Preview Redesign (root cause: document preview
// depended on a prior "debt.query" planner step's cached results[],
// silently defaulting to ฿0.00 when that step never ran). Self-contained:
// orchestrates PartnerProfile + GetCurrentDebt + InvoiceItems +
// CalculateTax + GenerateDocument itself, every time, regardless of what
// earlier plan steps did or didn't run. Same GetCurrentDebt call the
// Relationship header uses — one source of truth for both. Per owner
// decision 2026-07-17: never fabricates a ฿0.00 document — if there is no
// outstanding debt, returns an explicit NO_OUTSTANDING_DEBT business state.
//
// Moved here from engines/validation/dispatcher.ts (owner, 2026-07-18,
// Architecture Drift fix) — it needs GenerateDocument (gateway's
// previewDocumentCreate), and engines/ is not allowed to import gateway/
// (registry/dependency-graph.json: the intended direction is gateway ->
// engines, never the reverse). cognitive/ is allowed to import both, same
// pattern already used everywhere else in this file. No behavior changed,
// only which file owns the orchestration.
async function generateInvoicePreview(p: { partner_id: string; document_type: string; note?: string }): Promise<InvoicePreviewResult> {
  const partnerResult = await dispatchCommand("partner.profile", { partner_id: p.partner_id });
  if (!partnerResult.ok || !partnerResult.data) {
    return { status: "PARTNER_NOT_FOUND", reason: "ไม่พบข้อมูลลูกค้ารายนี้ในระบบ" };
  }
  const partner = partnerResult.data as { id: string; name: string; tax_id?: string | null; phone?: string | null };

  const debtResult = await dispatchCommand("debt.current", { partner_id: p.partner_id });
  const debt = (debtResult.ok ? debtResult.data : null) as CurrentDebt | null;

  const itemsResult = await dispatchCommand("invoice.items", { partner_id: p.partner_id, debt });
  const itemsData = itemsResult.data as { status: "OK" | "NO_OUTSTANDING_DEBT"; items: { description: string; qty: number; unit: string; unitPrice: number }[] };

  if (itemsData.status === "NO_OUTSTANDING_DEBT") {
    return {
      status: "NO_OUTSTANDING_DEBT",
      reason: `${partner.name} ไม่มียอดหนี้ค้างชำระในระบบ`,
      suggested_actions: ["view_debt_history", "create_quotation", "create_manual_invoice", "cancel"],
    };
  }

  const items = itemsData.items;
  const subtotal = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);

  // Invoice Consistency Fix (owner, 2026-07-17): business.calculate_tax is
  // the ONLY VAT/total calculation in this whole flow. Its exact result
  // (`tax`) is passed through to previewDocumentCreate() as `payload.tax`
  // — which threads it into generateDoc() as DocData.precomputedSummary,
  // so html/flex_preview render these SAME numbers instead of generateDoc
  // computing its own. ConfirmInvoice later persists this exact same
  // result via the preview_token — never a second calculation.
  const taxResult = await dispatchCommand("business.calculate_tax", { amount: subtotal });
  const tax = taxResult.data as { subtotal: number; vat: number; vat_rate: number; total: number };

  const preview = await previewDocumentCreate({
    document_type: p.document_type,
    party_name: partner.name,
    customer_company_id: p.partner_id,
    net_amount: tax.total,
    items,
    note: p.note,
    tax: { subtotal: tax.subtotal, vatRate: tax.vat_rate, vat: tax.vat, total: tax.total },
  });

  if (!preview.ok || !preview.preview) {
    return { status: "ERROR", reason: preview.error ?? "ไม่สามารถสร้างพรีวิวเอกสารได้" };
  }
  const rendered = preview.preview as { document_number: string; html: string; flex_preview: unknown; summary: { subtotal: number; vat: number; total: number } };

  return {
    status: "OK",
    debt_summary: debt,
    items,
    total: rendered.summary.total,
    document_number: rendered.document_number,
    html: rendered.html,
    flex_preview: rendered.flex_preview,
    preview_token: preview.preview_token,
  };
}

async function executeDocumentCommand(tool: string, args: Record<string, string>, worldState: WorldState, results: StepResult[]): Promise<Record<string, unknown>> {
  const resolved = resolveCustomer(args.customer_id, worldState, results);
  const documentType = tool.replace(".create", "") as DocType;

  if (!resolved.name) throw new Error("ต้องรู้ชื่อลูกค้าก่อนสร้างเอกสาร");

  // Invoice Preview Redesign (owner, 2026-07-17): invoice/billing/receipt no
  // longer read a prior "debt.query" plan step's cached results[] (root
  // cause of the ฿0.00 preview bug — that step could be missing, fail, or
  // run out of order). GenerateInvoicePreview is self-contained: it
  // orchestrates PartnerProfile + GetCurrentDebt + InvoiceItems +
  // CalculateTax + GenerateDocument itself, every time. Works even if the
  // AI only ever said "create invoice for customer" with no prior steps.
  if (DEBT_DOCUMENT_TYPES.has(documentType)) {
    if (!resolved.id) throw new Error("ต้องระบุลูกค้าที่จับคู่กับบริษัทในระบบก่อนถึงจะออกเอกสารหนี้ได้");

    const r = await generateInvoicePreview({
      partner_id: resolved.id,
      document_type: documentType,
      note: [worldState.context.what].filter(Boolean).join("\n") || undefined,
    });

    // Owner decision 2026-07-17: never fabricate an empty financial
    // document — surface the real business state instead of a ฿0.00 card.
    if (r.status !== "OK") {
      return {
        document_type: documentType,
        party_name: resolved.name,
        status: r.status,
        reason: r.reason,
        suggested_actions: r.suggested_actions,
        presenter: { title: "ไม่สามารถออกเอกสารได้", summary: r.reason ?? "" },
      };
    }

    return {
      document_type: documentType,
      document_number: r.document_number,
      party_name: resolved.name,
      status: "preview",
      net_amount: r.total,
      html: r.html,
      items: r.items,
      debt_summary: r.debt_summary,
      presenter: {
        title: `${DOC_LABELS[documentType].th} ${r.document_number} (พรีวิว — ยังไม่บันทึก)`,
        summary: `${resolved.name} • ${(r.total ?? 0).toLocaleString("th-TH")} บาท — กดยืนยันเพื่อบันทึกจริงครับ`,
      },
      _preview_pending: true,
      _confirm_action: "document.create",
      _confirm_token: r.preview_token,
      _flex_preview: r.flex_preview,
    };
  }

  // Material-priced documents (quotation/boq/delivery_order) — unchanged
  // scope, separate capability (material.quote), not part of this redesign.
  const items = await buildMaterialItems(worldState.context.raw_input, resolved.id);
  const label = DOC_LABELS[documentType] ?? DOC_LABELS.invoice;
  const netAmount = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);

  const preview = await previewDocumentCreate({
    document_type: documentType,
    party_name: resolved.name,
    customer_company_id: resolved.id || undefined,
    net_amount: netAmount,
    note: [worldState.context.what].filter(Boolean).join("\n") || undefined,
    items,
  });

  if (!preview.ok || !preview.preview) {
    throw new Error(preview.error ?? "เตรียมพรีวิวเอกสารไม่สำเร็จ");
  }

  const p = preview.preview as {
    document_number: string; html: string; summary: { total: number };
    items: unknown; flex_preview: unknown;
  };

  return {
    document_type: documentType,
    document_number: p.document_number,
    party_name: resolved.name,
    status: "preview",
    net_amount: p.summary.total,
    html: p.html,
    summary: p.summary,
    items: p.items,
    presenter: {
      title: `${label.th} ${p.document_number} (พรีวิว — ยังไม่บันทึก)`,
      summary: `${resolved.name} • ${p.summary.total.toLocaleString("th-TH")} บาท — กดยืนยันเพื่อบันทึกจริงครับ`,
    },
    _preview_pending: true,
    _confirm_action: "document.create",
    _confirm_token: preview.preview_token,
    _flex_preview: p.flex_preview,
  };
}

async function presentDocument(results: StepResult[]): Promise<Record<string, unknown>> {
  const created = findLatestCreateResult(results);
  if (!created) throw new Error("ไม่มีเอกสารที่สร้างสำหรับ Presenter");
  return formatDocumentCreateResult(created) as unknown as Record<string, unknown>;
}

async function exportPdf(args: Record<string, string>, results: StepResult[]): Promise<Record<string, unknown>> {
  const created = findLatestCreateResult(results);
  const documentId = args.document_id || String(created?.document_id ?? created?.id ?? "");
  if (!documentId) throw new Error("ไม่มี document_id สำหรับ export PDF");

  const result = await executeCapability("documents.export", {
    document_id: documentId,
    document_number: args.document_number || String(created?.document_number ?? ""),
    html: args.html || String(created?.html ?? ""),
  }, true);

  if (!result.ok) throw new Error(result.error ?? "export PDF ไม่สำเร็จ");
  return {
    document_id: documentId,
    pdf_url: String(result.result?.pdf_url ?? result.result?.url ?? `document://${documentId}.pdf`),
    export_result: result.result,
  };
}

async function sendLine(args: Record<string, string>, results: StepResult[]): Promise<Record<string, unknown>> {
  const created = findLatestCreateResult(results);
  const presented = findResultObject(results, "document.present");
  const pdf = findResultObject(results, "pdf.export");
  const message = args.message
    || String(presented?.summary ?? "")
    || String(created?.document_number ?? "สร้างเอกสารเรียบร้อย");

  const result = await executeCapability("communication.send_message", {
    customer_id: args.customer_id,
    message,
    document_number: String(created?.document_number ?? ""),
    pdf_url: String(pdf?.pdf_url ?? args.pdf_url ?? ""),
  }, true);

  if (!result.ok) throw new Error(result.error ?? "ส่ง LINE ไม่สำเร็จ");
  return result.result ?? {};
}

async function openLineRuntime(): Promise<Record<string, unknown>> {
  const result = await executeV6({
    tool_id: "line",
    action: "open",
    payload: {},
    confirmed: true,
  });

  if (!result.ok) throw new Error(result.error ?? "เปิด LINE ไม่สำเร็จ");
  return result.result ?? {};
}

async function executePendingAction(action: string | undefined): Promise<Record<string, unknown>> {
  if (!action) throw new Error("ไม่มี pending action ให้ดำเนินการ");
  if (/LINE|ไลน์/i.test(action)) return openLineRuntime();
  throw new Error(`pending action ยังไม่มี runtime รองรับ: ${action}`);
}

function resolveRuntimeArgs(args: Record<string, string>, results: StepResult[]): Record<string, string> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => {
    if (!value.startsWith("$")) return [key, value];
    const resolved = resolveReference(value, results);
    return [key, resolved === undefined || resolved === null ? value : String(resolved)];
  }));
}

function resolveReference(ref: string, results: StepResult[]): unknown {
  const match = ref.match(/^\$(\d+)\.(.+)$/);
  if (!match) return undefined;
  const result = results[Number(match[1])];
  const data = Array.isArray(result?.data) ? result.data[0] ?? null : result?.data;
  return readPath(data, match[2]);
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) return current[Number(part)];
    return (current as Record<string, unknown>)[part];
  }, value);
}

function resolveCustomer(customerId: string | undefined, worldState: WorldState, results: StepResult[]) {
  const identity = findResultArray(results, "identity.resolve");
  const first = identity.length === 1 ? identity[0] : null;
  return {
    id: customerId && !customerId.startsWith("$") ? customerId : String(first?.id ?? worldState.context.who_id ?? ""),
    name: String(first?.name ?? worldState.context.who ?? ""),
  };
}

function findResultArray(results: StepResult[], tool: string): Record<string, unknown>[] {
  const data = results.find((result) => result.tool === tool && result.success)?.data;
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

function findResultObject(results: StepResult[], tool: string): Record<string, unknown> | null {
  const data = results.find((result) => result.tool === tool && result.success)?.data;
  if (!data || Array.isArray(data)) return null;
  return data;
}

function findLatestCreateResult(results: StepResult[]): Record<string, unknown> | null {
  const result = [...results].reverse().find((r) => r.success && r.tool.endsWith(".create"));
  if (!result?.data || Array.isArray(result.data)) return null;
  return result.data;
}

function matchesCustomer(value: unknown, name: string | null | undefined): boolean {
  if (!name) return true;
  return String(value ?? "").toLowerCase().includes(name.toLowerCase());
}

// Real quantity+unit pattern from actual customer requests seen in
// business_events.quantity_unit ("คิว", "ตัน", "คัน", "เที่ยว", "ถุง",
// "ลบ.ม.") — see supabase/migrations/20260710000001_business_events.sql.
const QUANTITY_PATTERN = /(\d+(?:\.\d+)?)\s*(คิว|ตัน|คัน|เที่ยว|ถุง|ลบ\.ม\.|ลูกบาศก์เมตร|กก\.?|ตร\.ม\.?)/;

// Builds real DocItem[] for a material-type document (quotation/BOQ/
// delivery-order) from the customer's actual raw message, using the real
// material catalog and the real pit-pricing engine — never fabricates a
// material, quantity, or price. Throws a clear, actionable error (same
// pattern as the "ต้องรู้ชื่อลูกค้า" check above) when any of the three
// real inputs it needs (quantity+unit, a resolvable material, a priced pit
// reachable from the customer's known GPS) is missing, instead of silently
// producing an empty or zero-priced document.
async function buildMaterialItems(rawInput: string, customerId: string) {
  const qtyMatch = rawInput.match(QUANTITY_PATTERN);
  if (!qtyMatch) {
    throw new Error(`ไม่พบจำนวนและหน่วยในข้อความ (เช่น "หิน 30 คิว") กรุณาระบุให้ชัดเจนก่อนสร้างเอกสาร: "${rawInput}"`);
  }
  const quantity = Number(qtyMatch[1]);

  // GenerateMaterialQuote(raw_input, quantity, customer_id) — DNA OS
  // capability, owner 2026-07-17, Architecture Correction. AI no longer
  // imports Material Resolver / GPS lookup / Pricing Engine directly; it
  // asks one named command and only knows the business response.
  const dispatched = await dispatchCommand("material.quote", { raw_input: rawInput, quantity, customer_id: customerId });
  if (!dispatched.ok) throw new Error(dispatched.violations.join("; ") || "ไม่สามารถคำนวณราคาวัสดุได้");
  const quote = dispatched.data as {
    matched: boolean; candidates?: string[]; material_name?: string;
    quantity?: number; unit?: string; unit_price?: number; error?: string;
    distance_km?: number; trips?: number; transport_cost?: number;
  } | null;

  if (!quote?.matched) {
    throw new Error(
      quote?.candidates && quote.candidates.length > 0
        ? `ไม่แน่ใจว่าหมายถึงวัสดุไหน (${quote.candidates.join(", ")}) กรุณาระบุให้ชัดเจนกว่านี้`
        : `ไม่พบวัสดุที่ตรงกับข้อความนี้ในระบบ: "${rawInput}" กรุณาระบุชื่อวัสดุที่ลงทะเบียนไว้`
    );
  }
  if (quote.error === "no_gps") {
    throw new Error("ยังไม่มีพิกัดของลูกค้าคนนี้ในระบบ ไม่สามารถหาบ่อที่ใกล้ที่สุดเพื่อคำนวณราคาได้ — รอพิกัดจาก LINE ก่อน");
  }
  if (quote.error || quote.unit_price == null) {
    throw new Error(quote.error ?? "คำนวณราคาไม่สำเร็จ");
  }

  const items = [{
    description: quote.material_name ?? rawInput,
    qty: quantity,
    unit: quote.unit ?? "คิว",
    unitPrice: quote.unit_price,
  }];

  // Real transport cost (owner, 2026-07-24): a generated document needs the
  // actual total, unlike the chat quick-reply which deliberately omits it
  // ("ยังไม่รวมค่าขนส่ง"). material.quote now additively returns this,
  // computed via the existing, already-built vehicle-capacity/fuel/driver-
  // wage engines (engines/capacity.ts, engines/cost.ts) — no new pricing
  // math invented here, just wired for the first time.
  if (quote.transport_cost && quote.transport_cost > 0) {
    items.push({
      description: `ค่าขนส่ง (${quote.distance_km?.toFixed(1) ?? "-"} กม.${quote.trips ? ` × ${quote.trips} เที่ยว` : ""})`,
      qty: 1,
      unit: "รายการ",
      unitPrice: quote.transport_cost,
    });
  }

  return items;
}

// Removed 2026-07-17 (Invoice Preview Redesign, Rule 104 knowledge record):
// buildDebtItems(debts) used to build invoice/billing/receipt line items
// from `debts = findResultArray(results, "debt.query")` — a prior planner
// step's cached output that could be missing, fail, or run out of order,
// silently producing principal=0 → a ฿0.00 document (root cause traced and
// confirmed in the 2026-07-17 preview-pipeline audit). Replaced by the
// "invoice.items" capability in engines/validation/dispatcher.ts, which
// takes the SAME request's own GetCurrentDebt result — never a cached one —
// and returns an explicit NO_OUTSTANDING_DEBT state instead of a zero
// principal when there's genuinely no debt.
