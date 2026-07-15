/**
 * Domains Gateway — the one door for every irreversible domain action
 *
 * Mirrors gateway/actions.ts's exact preview→token→execute pattern (Rule 72:
 * every write must be confirmed by a human). Domain registration costs real
 * money; DNS/nameserver changes can break live email or routing for a
 * domain already in use — none of that may execute from a single call.
 *
 * Read-only operations (availability, suggestions, WHOIS, DNS record list,
 * nameserver get) do NOT go through this gateway — they carry no risk and
 * live directly in engines/domains/*. Only mutations do.
 */

import { randomUUID } from "crypto";
import * as hostinger from "@/engines/domains/hostinger";
import * as cloudflare from "@/engines/domains/cloudflare";
import * as vercelBinding from "@/engines/domains/vercel-binding";
import type { DomainRegistrationRequest, DnsRecord } from "@/engines/domains/types";

export type DomainAction =
  | "domain.register"
  | "dns.record.create"
  | "dns.record.update"
  | "dns.record.delete"
  | "nameserver.set"
  | "cloudflare.zone.create"
  | "vercel.domain.add"
  | "vercel.domain.remove";

export interface DomainActionResponse {
  ok: boolean;
  mode: "preview" | "execute";
  action: DomainAction;
  preview?: Record<string, unknown>;
  preview_token?: string;
  result?: Record<string, unknown>;
  error?: string;
}

const _tokenStore = new Map<string, { action: DomainAction; payload: Record<string, unknown>; expires: number }>();

function issueToken(action: DomainAction, payload: Record<string, unknown>): string {
  const token = randomUUID();
  _tokenStore.set(token, { action, payload, expires: Date.now() + 5 * 60 * 1000 });
  return token;
}

function consumeToken(token: string, action: DomainAction): { valid: boolean; error?: string; payload?: Record<string, unknown> } {
  const entry = _tokenStore.get(token);
  if (!entry) return { valid: false, error: "preview_token ไม่ถูกต้องหรือหมดอายุ — ต้อง preview ก่อน" };
  if (entry.action !== action) return { valid: false, error: `token ออกให้ action "${entry.action}" ไม่ใช่ "${action}"` };
  if (Date.now() > entry.expires) {
    _tokenStore.delete(token);
    return { valid: false, error: "preview_token หมดอายุ (5 นาที) — preview ใหม่" };
  }
  _tokenStore.delete(token);
  return { valid: true, payload: entry.payload };
}

// ---- domain.register ----

export function previewDomainRegister(req: DomainRegistrationRequest): DomainActionResponse {
  const token = issueToken("domain.register", req as unknown as Record<string, unknown>);
  return {
    ok: true, mode: "preview", action: "domain.register", preview_token: token,
    preview: {
      domain: req.domain, years: req.years, contact_email: req.contact.email,
      will_change: ["จดทะเบียนโดเมนใหม่จริง — มีค่าใช้จ่ายจริง", "จะปรากฏใน Hostinger portfolio ของบัญชีจริง"],
      warning: "การกระทำนี้เสียเงินจริงและย้อนกลับไม่ได้ (ค่าธรรมเนียมจดทะเบียนไม่คืน) — ตรวจสอบชื่อโดเมนและจำนวนปีให้ถูกต้องก่อนยืนยัน",
    },
  };
}

export async function executeDomainRegister(token: string): Promise<DomainActionResponse> {
  const consumed = consumeToken(token, "domain.register");
  if (!consumed.valid) return { ok: false, mode: "execute", action: "domain.register", error: consumed.error };
  const req = consumed.payload as unknown as DomainRegistrationRequest;
  const r = await hostinger.registerDomain(req);
  if (!("ok" in r) || !r.ok) return { ok: false, mode: "execute", action: "domain.register", error: "error" in r ? r.error : "unknown error" };
  return { ok: true, mode: "execute", action: "domain.register", result: r.result as unknown as Record<string, unknown> };
}

// ---- nameserver.set ----

export function previewNameserverSet(domain: string, nameservers: string[]): DomainActionResponse {
  const token = issueToken("nameserver.set", { domain, nameservers });
  return {
    ok: true, mode: "preview", action: "nameserver.set", preview_token: token,
    preview: {
      domain, new_nameservers: nameservers,
      will_change: [`DNS authority ของ ${domain} จะย้ายไปที่ nameserver ที่ระบุ — เว็บ/อีเมลที่ใช้โดเมนนี้อยู่จะหยุดทำงานถ้า nameserver ใหม่ยังไม่ได้ตั้งค่า record ให้ครบ`],
      warning: "ถ้าโดเมนนี้มีอีเมลหรือเว็บที่ใช้งานจริงอยู่แล้ว ต้องตั้งค่า DNS record ทั้งหมดที่ nameserver ปลายทางให้ครบก่อน ไม่งั้นจะดับทันทีที่เปลี่ยน",
    },
  };
}

export async function executeNameserverSet(token: string): Promise<DomainActionResponse> {
  const consumed = consumeToken(token, "nameserver.set");
  if (!consumed.valid) return { ok: false, mode: "execute", action: "nameserver.set", error: consumed.error };
  const { domain, nameservers } = consumed.payload as { domain: string; nameservers: string[] };
  const r = await hostinger.setNameservers(domain, nameservers);
  if (!("ok" in r) || !r.ok) return { ok: false, mode: "execute", action: "nameserver.set", error: "error" in r ? r.error : "unknown error" };
  return { ok: true, mode: "execute", action: "nameserver.set" };
}

// ---- dns.record.create / update / delete ----

export function previewDnsRecordCreate(zoneId: string, record: DnsRecord): DomainActionResponse {
  const token = issueToken("dns.record.create", { zoneId, record });
  return {
    ok: true, mode: "preview", action: "dns.record.create", preview_token: token,
    preview: { zoneId, record, will_change: [`สร้าง DNS record ${record.type} ${record.name} -> ${record.content}`] },
  };
}

export async function executeDnsRecordCreate(token: string): Promise<DomainActionResponse> {
  const consumed = consumeToken(token, "dns.record.create");
  if (!consumed.valid) return { ok: false, mode: "execute", action: "dns.record.create", error: consumed.error };
  const { zoneId, record } = consumed.payload as { zoneId: string; record: DnsRecord };
  const r = await cloudflare.createDnsRecord(zoneId, record);
  if (!("ok" in r) || !r.ok) return { ok: false, mode: "execute", action: "dns.record.create", error: "error" in r ? r.error : "unknown error" };
  return { ok: true, mode: "execute", action: "dns.record.create", result: r.record as unknown as Record<string, unknown> };
}

export function previewDnsRecordUpdate(zoneId: string, recordId: string, patch: Partial<DnsRecord>): DomainActionResponse {
  const token = issueToken("dns.record.update", { zoneId, recordId, patch });
  return {
    ok: true, mode: "preview", action: "dns.record.update", preview_token: token,
    preview: { zoneId, recordId, patch, will_change: ["แก้ไข DNS record ที่มีอยู่ — อาจกระทบเว็บ/อีเมลที่ใช้ record นี้อยู่"] },
  };
}

export async function executeDnsRecordUpdate(token: string): Promise<DomainActionResponse> {
  const consumed = consumeToken(token, "dns.record.update");
  if (!consumed.valid) return { ok: false, mode: "execute", action: "dns.record.update", error: consumed.error };
  const { zoneId, recordId, patch } = consumed.payload as { zoneId: string; recordId: string; patch: Partial<DnsRecord> };
  const r = await cloudflare.updateDnsRecord(zoneId, recordId, patch);
  if (!("ok" in r) || !r.ok) return { ok: false, mode: "execute", action: "dns.record.update", error: "error" in r ? r.error : "unknown error" };
  return { ok: true, mode: "execute", action: "dns.record.update" };
}

export function previewDnsRecordDelete(zoneId: string, recordId: string, description: string): DomainActionResponse {
  const token = issueToken("dns.record.delete", { zoneId, recordId });
  return {
    ok: true, mode: "preview", action: "dns.record.delete", preview_token: token,
    preview: { zoneId, recordId, description, will_change: ["ลบ DNS record นี้ถาวร — ย้อนกลับไม่ได้ (ต้องสร้างใหม่เอง)"] },
  };
}

export async function executeDnsRecordDelete(token: string): Promise<DomainActionResponse> {
  const consumed = consumeToken(token, "dns.record.delete");
  if (!consumed.valid) return { ok: false, mode: "execute", action: "dns.record.delete", error: consumed.error };
  const { zoneId, recordId } = consumed.payload as { zoneId: string; recordId: string };
  const r = await cloudflare.deleteDnsRecord(zoneId, recordId);
  if (!("ok" in r) || !r.ok) return { ok: false, mode: "execute", action: "dns.record.delete", error: "error" in r ? r.error : "unknown error" };
  return { ok: true, mode: "execute", action: "dns.record.delete" };
}

// ---- cloudflare.zone.create ----

export function previewZoneCreate(domain: string): DomainActionResponse {
  const token = issueToken("cloudflare.zone.create", { domain });
  return {
    ok: true, mode: "preview", action: "cloudflare.zone.create", preview_token: token,
    preview: {
      domain,
      will_change: [`เพิ่ม ${domain} เข้า Cloudflare — ต้องเปลี่ยน nameserver ที่ registrar (Hostinger) ให้ชี้มา Cloudflare ด้วยจึงจะมีผลจริง`],
      warning: "ขั้นตอนนี้แค่เพิ่ม zone ใน Cloudflare — ยังไม่เปลี่ยน nameserver จริง (เป็นอีก action แยกต่างหาก: nameserver.set)",
    },
  };
}

export async function executeZoneCreate(token: string): Promise<DomainActionResponse> {
  const consumed = consumeToken(token, "cloudflare.zone.create");
  if (!consumed.valid) return { ok: false, mode: "execute", action: "cloudflare.zone.create", error: consumed.error };
  const { domain } = consumed.payload as { domain: string };
  const r = await cloudflare.createZone(domain);
  if (!("ok" in r) || !r.ok) return { ok: false, mode: "execute", action: "cloudflare.zone.create", error: "error" in r ? r.error : "unknown error" };
  return { ok: true, mode: "execute", action: "cloudflare.zone.create", result: r.zone as unknown as Record<string, unknown> };
}

// ---- vercel.domain.add / remove ----

export function previewVercelDomainAdd(domain: string): DomainActionResponse {
  const token = issueToken("vercel.domain.add", { domain });
  return {
    ok: true, mode: "preview", action: "vercel.domain.add", preview_token: token,
    preview: { domain, will_change: [`ผูก ${domain} เข้ากับโปรเจกต์ dna-os-deadboard บน Vercel — ต้องมี DNS record ชี้มา Vercel ให้ถูกต้องก่อนจึงจะใช้งานได้จริง`] },
  };
}

export async function executeVercelDomainAdd(token: string): Promise<DomainActionResponse> {
  const consumed = consumeToken(token, "vercel.domain.add");
  if (!consumed.valid) return { ok: false, mode: "execute", action: "vercel.domain.add", error: consumed.error };
  const { domain } = consumed.payload as { domain: string };
  const r = await vercelBinding.addDomainToProject(domain);
  if (!r.ok) return { ok: false, mode: "execute", action: "vercel.domain.add", error: r.error };
  return { ok: true, mode: "execute", action: "vercel.domain.add", result: r.result as unknown as Record<string, unknown> };
}

export function previewVercelDomainRemove(domain: string): DomainActionResponse {
  const token = issueToken("vercel.domain.remove", { domain });
  return {
    ok: true, mode: "preview", action: "vercel.domain.remove", preview_token: token,
    preview: { domain, will_change: [`ถอด ${domain} ออกจากโปรเจกต์ — โดเมนนี้จะเข้าเว็บไม่ได้ทันทีจนกว่าจะผูกใหม่`], warning: "ย้อนกลับได้โดยการ vercel.domain.add ใหม่ แต่จะมี downtime ระหว่างนั้น" },
  };
}

export async function executeVercelDomainRemove(token: string): Promise<DomainActionResponse> {
  const consumed = consumeToken(token, "vercel.domain.remove");
  if (!consumed.valid) return { ok: false, mode: "execute", action: "vercel.domain.remove", error: consumed.error };
  const { domain } = consumed.payload as { domain: string };
  const r = await vercelBinding.removeDomainFromProject(domain);
  if (!r.ok) return { ok: false, mode: "execute", action: "vercel.domain.remove", error: r.error };
  return { ok: true, mode: "execute", action: "vercel.domain.remove" };
}
