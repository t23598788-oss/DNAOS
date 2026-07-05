/**
 * Cognitive Executor — runs Planner steps through existing V2/V6 runtime modules.
 * ทุก step ที่มี query handler ใน dispatcher จะถูกบังคับใช้กฎจาก command-registry.json
 */

import { getDebtTrackings, getDocuments, getJobs, getMaterialTypes, getOpenDebts, getPartners } from "@/lib/supabase/queries";
import { executeDocumentCreate } from "@/lib/v2-rules/actions";
import { dispatch as dispatchCommand, isRegistered } from "@/lib/v2-rules/dispatcher";
import { calcDebtFull } from "@/lib/v3-engines/debt/engine";
import { generateDoc, DOC_LABELS, type DocData, type DocType } from "@/lib/documents/engine";
import { executeCapability } from "@/lib/v6-executor/capability-manager";
import { execute as executeV6 } from "@/lib/v6-executor";
import { formatDocumentCreateResult } from "@/lib/v5-presenter/formatter";
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

  const { items, debtInfo } = buildDebtItems(debts);
  const label = DOC_LABELS[documentType] ?? DOC_LABELS.invoice;
  const docNumber = `${label.prefix}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`;

  const docData: DocData = {
    type: documentType,
    docNumber,
    date: new Date().toISOString().split("T")[0],
    status: "draft",
    company: { name: "บจก. ดีเอ็นเอ โอเอส", taxId: "0405569002851" },
    customer: { name: resolved.name },
    items,
    vatRate: 0.07,
    debt: debtInfo,
    notes: worldState.context.what ?? undefined,
  };

  const rendered = generateDoc(docData);

  return {
    document_type: documentType,
    document_number: docNumber,
    party_name: resolved.name,
    status: "draft",
    net_amount: rendered.summary.total,
    html: rendered.html,
    summary: rendered.summary,
    items,
    presenter: {
      title: `${rendered.label.th} ${docNumber}`,
      summary: `${resolved.name} • ${rendered.summary.total.toLocaleString("th-TH")} บาท`,
    },
    _draft: true,
    _doc_data: docData,
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
