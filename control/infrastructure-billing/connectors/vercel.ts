/**
 * หน้าที่: ดึงค่าใช้จ่ายจริงจาก Vercel แล้วแปลงเป็น BillingRecord กลาง
 *
 * ช่องทางที่ทดสอบแล้วว่าใช้ได้จริง (2026-08-27):
 *   API  GET /v2/teams/{id}          -> billing.invoiceItems, plan, status,
 *                                       period, entitlements  ✅
 *   API  GET /v9/projects            -> project, crons                ✅
 *   EMAIL ใบเสร็จที่จ่ายสำเร็จ        -> baseline ของรอบก่อน           ✅
 *   API  /v1/teams/{id}/invoices     -> 404 เข้าไม่ได้                 ❌
 *   API  /v1/usage, /v1/teams/{id}/usage -> 400/404 เข้าไม่ได้         ❌
 *
 * ผลของช่องที่เข้าไม่ได้: usage แยกรายบรรทัดไม่ได้ จึงเหลือเป็นรายการเดียว
 * ที่ derived=true และ classification=UNKNOWN — มองเห็นได้ ไม่ถูกกลบ
 *
 * credential: อ่าน token ของ Vercel CLI ที่ Owner ล็อกอินไว้แล้วในเครื่อง
 * ไม่เคยพิมพ์ค่าออก log และไม่เก็บลง evidence
 *
 * Input: none (อ่านจากเครื่องและ API)
 * Output: `collectVercel`, `VERCEL_CHANNELS`
 * Dependency ที่อนุญาต: ../types.ts, node built-ins
 * สิ่งที่ห้ามแตะ: ห้ามเรียก endpoint ที่เปลี่ยนแปลงอะไร (POST/PATCH/DELETE)
 * connector นี้อ่านอย่างเดียวโดยเจตนา
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import type { BillingRecord, CostClassification, EvidenceChannel } from "../types";

const AUTH_PATH = join(homedir(), "Library/Application Support/com.vercel.cli/auth.json");

export interface ChannelStatus {
  readonly channel: EvidenceChannel;
  readonly endpoint: string;
  readonly available: boolean;
  readonly detail: string;
}

export const VERCEL_CHANNELS: readonly { channel: EvidenceChannel; endpoint: string }[] = [
  { channel: "API", endpoint: "/v2/teams/{teamId}" },
  { channel: "API", endpoint: "/v9/projects" },
  { channel: "USAGE_ENDPOINT", endpoint: "/v1/usage" },
  { channel: "INVOICE", endpoint: "/v1/teams/{teamId}/invoices" },
];

function token(): string | null {
  if (!existsSync(AUTH_PATH)) return null;
  try {
    const value = (JSON.parse(readFileSync(AUTH_PATH, "utf8")) as { token?: string }).token;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch { return null; }
}

function apiGet(path: string, bearer: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = httpsRequest({ hostname: "api.vercel.com", path, method: "GET", timeout: 25000, headers: { Authorization: `Bearer ${bearer}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
    req.on("error", (error) => resolve({ status: 0, body: error.message }));
    req.end();
  });
}

/** ราคาใน Vercel API เป็นหน่วยย่อยอยู่แล้ว (pro=2000 คือ $20.00) */
interface VercelInvoiceItem { price?: number; quantity?: number; highestQuantity?: number; createdAt?: number; hidden?: boolean; batch?: number; threshold?: number }

export interface VercelCollection {
  readonly ok: boolean;
  readonly records: readonly BillingRecord[];
  readonly channels: readonly ChannelStatus[];
  readonly account_id: string | null;
  readonly plan: string | null;
  readonly payment_status: string | null;
  readonly period_start: string | null;
  readonly period_end: string | null;
  readonly entitlements: Readonly<Record<string, string>>;
  readonly detail: string;
}

/**
 * @param invoiceTotalMinor ยอดบน invoice จริง (ถ้าทราบ) ใช้กระทบยอดและสร้าง
 *        รายการส่วนต่างที่ระบุชัดว่า derived — ไม่ได้เอาไว้ดัดตัวเลขให้ตรง
 */
export async function collectVercel({ teamId, invoiceTotalMinor = null, invoiceId = null, now = new Date().toISOString() }: {
  teamId: string; invoiceTotalMinor?: number | null; invoiceId?: string | null; now?: string;
}): Promise<VercelCollection> {
  const channels: ChannelStatus[] = [];
  const bearer = token();
  if (bearer === null) {
    return {
      ok: false, records: [], channels: [{ channel: "API", endpoint: AUTH_PATH, available: false, detail: "ไม่พบ token ของ Vercel CLI — Owner ต้อง vercel login ก่อน" }],
      account_id: null, plan: null, payment_status: null, period_start: null, period_end: null, entitlements: {},
      detail: "ACCESS_BLOCKED: ไม่มี credential",
    };
  }

  const team = await apiGet(`/v2/teams/${teamId}`, bearer);
  channels.push({ channel: "API", endpoint: `/v2/teams/${teamId}`, available: team.status === 200, detail: `HTTP ${team.status}` });
  if (team.status !== 200) {
    return { ok: false, records: [], channels, account_id: teamId, plan: null, payment_status: null, period_start: null, period_end: null, entitlements: {}, detail: `ACCESS_BLOCKED: team API HTTP ${team.status}` };
  }

  const parsed = JSON.parse(team.body) as { name?: string; billing?: Record<string, unknown> };
  const billing = (parsed.billing ?? {}) as {
    plan?: string; status?: string; currency?: string;
    period?: { start?: number; end?: number };
    invoiceItems?: Record<string, VercelInvoiceItem>;
    entitlements?: Record<string, { createdAt?: number }>;
  };

  const iso = (ms?: number): string => (typeof ms === "number" ? new Date(ms).toISOString() : now);
  const periodStart = iso(billing.period?.start);
  const periodEnd = iso(billing.period?.end);
  const currency = billing.currency ?? "usd";
  const items = billing.invoiceItems ?? {};

  // ช่องที่ทดสอบแล้วว่าเข้าไม่ได้ — ยิงจริงเพื่อยืนยันสถานะ ไม่ใช่จำไว้เฉย ๆ
  for (const [path, channel] of [["/v1/usage", "USAGE_ENDPOINT"], [`/v1/teams/${teamId}/invoices`, "INVOICE"]] as const) {
    const probe = await apiGet(path, bearer);
    channels.push({ channel, endpoint: path, available: probe.status === 200, detail: `HTTP ${probe.status}` });
  }

  const records: BillingRecord[] = [];
  const push = (input: {
    service: string; resource: string | null; usage_type: string;
    quantity: number | null; unit: string | null; unitPrice: number | null;
    amount: number; classification: CostClassification; channel: EvidenceChannel;
    evidence: string; derived?: boolean; detail: string; observedAt?: string;
  }): void => {
    records.push({
      billing_record_id: `billing-${randomUUID()}`,
      provider: "vercel",
      account_id: teamId,
      project_id: null,
      service: input.service,
      resource: input.resource,
      usage_type: input.usage_type,
      usage_quantity: input.quantity,
      usage_unit: input.unit,
      unit_price_minor: input.unitPrice,
      subtotal_minor: input.amount,
      discount_minor: 0,
      tax_minor: 0,
      amount_minor: input.amount,
      currency,
      period_start: periodStart,
      period_end: periodEnd,
      observed_at: input.observedAt ?? now,
      invoice_id: invoiceId,
      evidence_ref: input.evidence,
      evidence_channel: input.channel,
      classification: input.classification,
      derived: input.derived === true,
      detail: input.detail,
    });
  };

  // ---- รายการคงที่ที่อ่านได้จริงจาก API ----
  for (const [name, item] of Object.entries(items)) {
    const quantity = item.quantity ?? 0;
    if (quantity <= 0) continue; // ยังไม่ถูกคิดเงินในรอบนี้
    const price = item.price ?? 0;
    const amount = price * quantity;
    // includedAllocationUsd เป็นเครดิต ไม่ใช่ค่าใช้จ่าย
    const isCredit = name === "includedAllocationUsd";
    push({
      service: name === "pro" ? "plan" : name.includes("secureConnect") ? "secure-compute" : name,
      resource: name,
      usage_type: isCredit ? "included_allocation" : "fixed_monthly",
      quantity, unit: isCredit ? "usd" : "month",
      unitPrice: isCredit ? null : price,
      amount: isCredit ? 0 : amount,
      classification: "UNKNOWN",
      channel: "API",
      evidence: `vercel:api:/v2/teams/${teamId}#billing.invoiceItems.${name}`,
      detail: isCredit
        ? `เครดิตที่รวมมากับแพ็กเกจ ${quantity} usd (ไม่นับเป็นค่าใช้จ่าย)`
        : `ค่าคงที่ ${price} หน่วยย่อย × ${quantity}`,
      observedAt: item.createdAt ? iso(item.createdAt) : now,
    });
  }

  // ---- ส่วนต่างที่ยังแยกไม่ได้ ----
  if (invoiceTotalMinor !== null) {
    const known = records.reduce((sum, r) => sum + r.amount_minor, 0);
    const residual = invoiceTotalMinor - known;
    if (residual !== 0) {
      push({
        service: "usage",
        resource: null,
        usage_type: "unitemised_usage",
        quantity: null, unit: null, unitPrice: null,
        amount: residual,
        classification: "UNKNOWN",
        channel: "DERIVED",
        derived: true,
        evidence: `derived: invoice total ${invoiceTotalMinor} ลบด้วยรายการคงที่ที่พิสูจน์ได้ ${known}; usage endpoint ตอบ ${channels.find((c) => c.channel === "USAGE_ENDPOINT")?.detail ?? "ไม่ทราบ"}`,
        detail: "ยอดส่วนที่แยกรายบรรทัดไม่ได้ เพราะ usage/invoice endpoint เข้าไม่ถึง — บันทึกเป็น UNKNOWN ไม่ใช่เดาว่าเป็น resource ใด",
      });
    }
  }

  const entitlements: Record<string, string> = {};
  for (const [k, v] of Object.entries(billing.entitlements ?? {})) entitlements[k] = iso(v.createdAt);

  return {
    ok: true, records, channels,
    account_id: teamId,
    plan: billing.plan ?? null,
    payment_status: billing.status ?? null,
    period_start: periodStart, period_end: periodEnd,
    entitlements,
    detail: `อ่านได้ ${records.length} รายการจาก ${channels.filter((c) => c.available).length}/${channels.length} ช่องทาง`,
  };
}
