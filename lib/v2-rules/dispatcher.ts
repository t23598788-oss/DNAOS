/**
 * Command Dispatcher — ผู้บังคับใช้กฎรัฐธรรมนูญ DNA OS
 *
 * ทุก command ต้องผ่านที่นี่:
 * 1. ตรวจว่า command อยู่ใน registry ไหม (ไม่มี = reject)
 * 2. ตรวจ input ตาม schema ที่ประกาศ
 * 3. ใส่ constraints อัตโนมัติ (document_type, status filter)
 * 4. ตรวจ requires_confirmation
 */

import {
  getOpenDebts, getAllDebts, getDebtTrackings, getDocuments,
  getLatestInvoice, getReceipts, getJobs, getPartners,
  getMaterialTypes, getPendingDrafts,
  getPartnersWithDocumentSummary, getDocumentsByPartner, getBusinessEventsByPartner,
} from "@/lib/supabase/queries";
import { buildPartnerTimeline, buildPartnerSummary } from "@/lib/v3-engines/partner/timeline";
import registry from "@/lib/registry/command-registry.json";

// ── Types ──

export interface DispatchResult {
  ok: boolean;
  command: string;
  data: unknown;
  requires_confirmation: boolean;
  violations: string[];
}

interface CommandDef {
  owner: string;
  layer: string;
  input: Record<string, string>;
  output: string;
  description: string;
  requires_confirmation: boolean;
}

// ── Query Constraints ──
// command → ฟังก์ชันดึงข้อมูลที่ใส่ filter ถูกต้องตามกฎ

type QueryFn = (payload: Record<string, unknown>) => Promise<unknown>;

const QUERY_MAP: Record<string, QueryFn> = {
  "debt.list":        async () => getOpenDebts(),
  "debt.all":         async () => getAllDebts(),
  "debt.trackings":   async () => getDebtTrackings(),
  "invoice.list":     async () => getDocuments("invoice"),
  "invoice.latest":   async () => getLatestInvoice(),
  "document.list":    async () => getDocuments(),
  "document.boq":     async () => getDocuments("boq"),
  "document.po":      async () => getDocuments("purchase_order"),
  "document.do":      async () => getDocuments("delivery_order"),
  "document.receipt":  async () => getReceipts(),
  "draft.list":       async () => getPendingDrafts(),
  "job.list":         async () => getJobs(),
  "job.active":       async () => getJobs("IN_PROGRESS"),
  "partner.list":     async () => getPartnersWithDocumentSummary(),
  "partner.timeline": async (p) => {
    const partnerId = String(p.partner_id ?? "");
    if (!partnerId) throw new Error("ต้องระบุ partner_id");
    const [docs, events] = await Promise.all([
      getDocumentsByPartner(partnerId),
      getBusinessEventsByPartner(partnerId),
    ]);
    const summary = buildPartnerSummary(
      { id: partnerId, name: "", partner_type_label: null, phone: null },
      docs,
    );
    const timeline = buildPartnerTimeline(docs, events);
    return { summary, timeline };
  },
  "material.list":    async () => getMaterialTypes(),
};

// ── Dispatcher ──

const commands = registry.commands as Record<string, CommandDef>;

export function isRegistered(command: string): boolean {
  return command in commands;
}

export function getCommandDef(command: string): CommandDef | null {
  return commands[command] ?? null;
}

export function listCommands(): string[] {
  return Object.keys(commands);
}

export function validateInput(command: string, payload: Record<string, unknown>): string[] {
  const def = commands[command];
  if (!def) return [`command "${command}" ไม่อยู่ใน registry — ปฏิเสธ`];

  const violations: string[] = [];
  for (const [field, type] of Object.entries(def.input)) {
    if (field.endsWith("?")) continue;
    if (!(field in payload)) {
      violations.push(`ขาด input "${field}" (ต้องเป็น ${type})`);
    }
  }
  return violations;
}

export async function dispatch(
  command: string,
  payload: Record<string, unknown> = {},
  confirmed = false,
): Promise<DispatchResult> {
  const def = commands[command];

  if (!def) {
    return {
      ok: false,
      command,
      data: null,
      requires_confirmation: false,
      violations: [`command "${command}" ไม่อยู่ใน registry — Shadow Command ถูกปฏิเสธ`],
    };
  }

  const violations = validateInput(command, payload);

  if (def.requires_confirmation && !confirmed) {
    return {
      ok: false,
      command,
      data: null,
      requires_confirmation: true,
      violations: violations.length > 0
        ? violations
        : [`command "${command}" ต้องได้รับการยืนยันจากมนุษย์ก่อน (Rule 72)`],
    };
  }

  if (violations.length > 0) {
    return { ok: false, command, data: null, requires_confirmation: def.requires_confirmation, violations };
  }

  const queryFn = QUERY_MAP[command];
  if (queryFn) {
    try {
      const data = await queryFn(payload);
      return { ok: true, command, data, requires_confirmation: false, violations: [] };
    } catch (err) {
      return {
        ok: false, command, data: null, requires_confirmation: false,
        violations: [`query error: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  return {
    ok: true,
    command,
    data: { message: `command "${command}" registered แต่ยังไม่มี query handler — ต้องพัฒนาเพิ่ม` },
    requires_confirmation: def.requires_confirmation,
    violations: [],
  };
}
