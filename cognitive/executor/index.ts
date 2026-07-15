/**
 * Cognitive Executor — runs Planner steps through existing V2/V6 runtime modules.
 * ทุก step ที่มี query handler ใน dispatcher จะถูกบังคับใช้กฎจาก command-registry.json
 */

import { getDebtTrackings, getDocuments, getJobs, getMaterialTypes, getOpenDebts, getPartners, getCustomerGps } from "@/services/supabase/queries";
import { previewDocumentCreate } from "@/gateway/actions";
import { loadCompanySettings } from "@/core/config/company-settings";
import { documentFlex } from "@/engines/documents/flex-template";
import { dispatch as dispatchCommand, isRegistered } from "@/engines/validation/dispatcher";
import { calcDebtFull } from "@/engines/debt/engine";
import { generateDoc, DOC_LABELS, type DocData, type DocType } from "@/engines/documents/engine";
import { resolveMaterial } from "@/engines/material-resolver";
import { tryQuoteMaterialPrice } from "@/engines/quote-price";
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

  const registryCommand = toRegistryCommand(step.tool, args);
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
      return getPartners();
    case "material.list":
      return getMaterialTypes();
    case "job.query":
      return queryJobs(worldState);
    case "job.list":
      return getJobs();
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

function toRegistryCommand(tool: string, args: Record<string, string>): string | null {
  const TOOL_TO_COMMAND: Record<string, string> = {
    "partner.list": "partner.list",
    "customer.list": "partner.list",
    "material.list": "material.list",
    "job.list": "job.list",
    "debt.query": "debt.list",
  };
  if (tool in TOOL_TO_COMMAND) return TOOL_TO_COMMAND[tool];
  if (tool === "document.query" || tool === "invoice.query") {
    const t = args.document_type;
    if (t === "invoice") return "invoice.list";
    if (t === "quotation") return "document.boq";
    if (t === "receipt") return "document.receipt";
    return "document.list";
  }
  return null;
}

async function resolveIdentity(name: string): Promise<Record<string, unknown>[]> {
  const query = name.trim().toLowerCase();
  if (!query) return [];
  const partners = await getPartners();
  return partners.filter((p) => String(p.name ?? "").toLowerCase().includes(query));
}

async function queryDebt(customerId: string | undefined, worldState: WorldState, results: StepResult[]): Promise<Record<string, unknown>[]> {
  const resolved = resolveCustomer(customerId, worldState, results);
  const customerName = resolved.name ?? worldState.context.who;
  const [debts, docs, trackings] = await Promise.all([getOpenDebts(), getDocuments(), getDebtTrackings()]);

  const invoiceDebts = debts
    .map((debt) => {
      const doc = docs.find((d) => d.id === debt.document_id);
      return { ...debt, customer_name: doc?.party_name ?? customerName ?? "" };
    })
    .filter((debt) => matchesCustomer(debt.customer_name, customerName));

  if (invoiceDebts.length > 0) return invoiceDebts;

  const matched = trackings.filter((t) => matchesCustomer(t.customer_name, customerName));
  try {
    const calculated = await Promise.all(
      matched.map((t) =>
        calcDebtFull({
          principal: Number(t.principal_amount),
          feeAmount: Number(t.principal_amount) * (Number(t.fee_rate ?? 5) / 100),
          dueDate: t.interest_start_at ?? t.created_at,
          paidAmount: 0,
          status: "DEBT",
        }),
      ),
    );
    return matched.map((t, i) => ({
      ...t,
      outstanding_amount: calculated[i].remaining,
      principal_amount: calculated[i].principal,
      fee_amount: calculated[i].fee,
      interest_amount: calculated[i].interestAccrued,
      days_overdue: calculated[i].daysOverdue,
      total_outstanding: calculated[i].totalOutstanding,
    }));
  } catch {
    return matched.map((t) => ({ ...t, outstanding_amount: t.principal_amount }));
  }
}

async function queryDocuments(customerId: string | undefined, worldState: WorldState, results: StepResult[], docType?: string): Promise<Record<string, unknown>[]> {
  const resolved = resolveCustomer(customerId, worldState, results);
  const docs = await getDocuments(docType);
  return docs.filter((doc) => matchesCustomer(doc.party_name, resolved.name ?? worldState.context.who));
}

async function queryJobs(worldState: WorldState): Promise<Record<string, unknown>[]> {
  const jobs = await getJobs();
  return jobs.filter((job) =>
    matchesCustomer(job.contact_name, worldState.context.who) ||
    matchesCustomer(job.project_name, worldState.context.who)
  );
}

async function executeDocumentCommand(tool: string, args: Record<string, string>, worldState: WorldState, results: StepResult[]): Promise<Record<string, unknown>> {
  const resolved = resolveCustomer(args.customer_id, worldState, results);
  const debts = findResultArray(results, "debt.query");
  const documentType = tool.replace(".create", "") as DocType;

  if (!resolved.name) throw new Error("ต้องรู้ชื่อลูกค้าก่อนสร้างเอกสาร");

  // Real bug fix 2026-07-13: quotation/BOQ/delivery-order documents were
  // always built via buildDebtItems(debts) — a debt-only converter — so a
  // normal "เสนอราคาให้..." request (no debt.query step, debts=[]) always
  // produced one fake "เงินต้นยกมา / 0.00" row and a 0.00 total, never the
  // actual material/quantity/price the customer asked for. Material-type
  // documents now build real items from the raw message + the real pricing
  // engine (engines/quote-price.ts) instead. Debt-related documents
  // (invoice/billing when a real debt exists) are unchanged.
  const { items, debtInfo } = MATERIAL_DOCUMENT_TYPES.has(documentType) && debts.length === 0
    ? { items: await buildMaterialItems(worldState.context.raw_input, resolved.id), debtInfo: undefined }
    : buildDebtItems(debts);
  const label = DOC_LABELS[documentType] ?? DOC_LABELS.invoice;
  const docNumber = `${label.prefix}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`;

  // Owner request 2026-07-11: การ์ดเอกสารต้องมีชื่อบริษัท/เลขภาษี/VAT จริง
  // จาก app_configs (core/config/company-settings.ts) แทนของ hardcode เดิม
  const company = await loadCompanySettings();

  const docData: DocData = {
    type: documentType,
    docNumber,
    date: new Date().toISOString().split("T")[0],
    status: "draft",
    company: { name: company.companyName || undefined, taxId: company.companyTaxId || undefined },
    customer: { name: resolved.name },
    items,
    vatRate: company.vatRate,
    payment: company.paymentBankName
      ? { bank: company.paymentBankName, account: company.paymentAccountNumber, accountName: company.paymentAccountName }
      : undefined,
    paymentRequired: documentType === "invoice" || documentType === "billing",
    debt: debtInfo,
    notes: [worldState.context.what, company.documentTerms].filter(Boolean).join("\n") || undefined,
  };

  const rendered = generateDoc(docData);

  // Rule 72: never write a real document straight from a chat command —
  // preview first, require an explicit human confirm (token) before
  // gateway/actions.ts touches the `documents` table. Owner-reported gap
  // 2026-07-11: this used to call executeDocumentCreate() directly, so
  // typing "เสนอราคาให้..." wrote a real document with zero confirmation.
  const preview = await previewDocumentCreate({
    document_type: documentType,
    document_number: docNumber,
    party_name: resolved.name,
    customer_company_id: resolved.id || undefined,
    net_amount: rendered.summary.total,
    issue_date: docData.date,
    note: docData.notes,
    items,
  });

  if (!preview.ok) {
    throw new Error(preview.error ?? "เตรียมพรีวิวเอกสารไม่สำเร็จ");
  }

  // Owner request 2026-07-11: "ให้เห็นภาพรายการก่อนที่จะกดส่งยืนยัน" — build the
  // exact Flex card that would be sent to the customer (same branding as the
  // real send at confirm time) so the admin sees the real card, not just text.
  const flexPreview = documentFlex({
    documentType,
    documentNumber: docNumber,
    partyName: resolved.name,
    items,
    summary: rendered.summary,
    branding: {
      ourCompanyName: company.companyName || undefined,
      ourCompanyTaxId: company.companyTaxId || undefined,
      terms: company.documentTerms || undefined,
      footerNote: company.documentFooterNote || undefined,
    },
  });

  return {
    document_type: documentType,
    document_number: docNumber,
    party_name: resolved.name,
    status: "preview",
    net_amount: rendered.summary.total,
    html: rendered.html,
    summary: rendered.summary,
    items,
    presenter: {
      title: `${rendered.label.th} ${docNumber} (พรีวิว — ยังไม่บันทึก)`,
      summary: `${resolved.name} • ${rendered.summary.total.toLocaleString("th-TH")} บาท — กดยืนยันเพื่อบันทึกจริงครับ`,
    },
    _preview_pending: true,
    _confirm_action: "document.create",
    _confirm_token: preview.preview_token,
    _doc_data: docData,
    _flex_preview: flexPreview,
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

const MATERIAL_DOCUMENT_TYPES = new Set<DocType>(["quotation", "boq", "delivery_order"]);

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

  const materialTypes = await getMaterialTypes();
  const match = resolveMaterial(rawInput, materialTypes);
  if (!match.matched) {
    throw new Error(
      match.candidates.length > 0
        ? `ไม่แน่ใจว่าหมายถึงวัสดุไหน (${match.candidates.map((c) => c.name).join(", ")}) กรุณาระบุให้ชัดเจนกว่านี้`
        : `ไม่พบวัสดุที่ตรงกับข้อความนี้ในระบบ: "${rawInput}" กรุณาระบุชื่อวัสดุที่ลงทะเบียนไว้`
    );
  }

  const gps = await getCustomerGps(customerId);
  if (!gps) {
    throw new Error("ยังไม่มีพิกัดของลูกค้าคนนี้ในระบบ ไม่สามารถหาบ่อที่ใกล้ที่สุดเพื่อคำนวณราคาได้ — รอพิกัดจาก LINE ก่อน");
  }

  const quote = await tryQuoteMaterialPrice(match.matched.name, quantity, gps);
  if (!quote.ok || quote.unitPrice == null) {
    throw new Error(quote.text);
  }

  return [{
    description: quote.materialName ?? match.matched.name,
    qty: quantity,
    unit: quote.quantityUnit ?? "คิว",
    unitPrice: quote.unitPrice,
  }];
}

function buildDebtItems(debts: Record<string, unknown>[]) {
  const items: { description: string; detail?: string; qty: number; unit: string; unitPrice: number }[] = [];
  let principal = 0;
  let fee = 0;
  let interest = 0;
  let daysOverdue = 0;
  let interestRate = 25;

  for (const d of debts) {
    const p = Number(d.principal_amount ?? d.outstanding_amount ?? 0);
    const f = Number(d.fee_amount ?? 0);
    const int = Number(d.interest_amount ?? 0);
    principal += p;
    fee += f;
    interest += int;
    daysOverdue = Math.max(daysOverdue, Number(d.days_overdue ?? 0));
  }

  items.push({ description: "เงินต้นยกมา", qty: 1, unit: "รายการ", unitPrice: principal });
  if (fee > 0) items.push({ description: "ค่าธรรมเนียม 5%", qty: 1, unit: "รายการ", unitPrice: fee });
  if (interest > 0) items.push({ description: `ดอกเบี้ย ${interestRate}% (${daysOverdue} วัน)`, qty: 1, unit: "รายการ", unitPrice: interest });

  if (items.length === 1 && principal === 0 && debts.length > 0) {
    const total = Number(debts[0].outstanding_amount ?? debts[0].principal_amount ?? 0);
    items[0].unitPrice = total;
  }

  const debtInfo = principal > 0 ? {
    principal,
    fee,
    daysOverdue,
    interestRate: interestRate / 100,
    interestAccrued: interest,
  } : undefined;

  return { items, debtInfo };
}
