/**
 * Domain Infrastructure — shared types
 *
 * Owner-authorized exception to Plan Lock (2026-07-13, DOMAIN_INFRASTRUCTURE
 * mission) — new capability, built on the frozen Phase 2 architecture without
 * touching it. Every write here (domain registration, DNS mutation,
 * nameserver change) is irreversible or costs real money, so every one of
 * them goes through gateway/domains.ts's Rule-72 preview→confirm→execute
 * flow — never auto-executed from an engine function directly.
 */

export interface DomainAvailability {
  domain: string;
  available: boolean;
  price?: { amount: number; currency: string; period_years: number };
  premium?: boolean;
}

export interface DomainSuggestion {
  domain: string;
  available: boolean;
  price?: { amount: number; currency: string; period_years: number };
}

export interface DomainRegistrationRequest {
  domain: string;
  years: number;
  contact: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_line1: string;
    city: string;
    state: string;
    zip: string;
    country: string; // ISO 3166-1 alpha-2
  };
  privacy_protection?: boolean;
}

export interface DomainRegistrationResult {
  domain: string;
  order_id: string;
  status: string;
  expires_at?: string;
}

export interface Nameservers {
  domain: string;
  nameservers: string[];
}

export interface WhoisRecord {
  domain: string;
  registrar: string | null;
  created_at: string | null;
  expires_at: string | null;
  nameservers: string[];
  status: string[];
}

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "CAA" | "SRV";

export interface DnsRecord {
  id?: string;
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number; // seconds, 1 = "automatic" (Cloudflare-specific meaning)
  priority?: number; // MX/SRV
  proxied?: boolean; // Cloudflare-specific (orange-cloud)
}

export interface ConnectorNotReadyError {
  ok: false;
  error: string;
  connector_slug: string;
  stage: "not_found" | "not_connected" | "not_enabled";
}

export function connectorNotReady(slug: string, stage: ConnectorNotReadyError["stage"]): ConnectorNotReadyError {
  const messages: Record<ConnectorNotReadyError["stage"], string> = {
    not_found: `Connector "${slug}" ยังไม่ถูกสร้างในระบบ — ไปที่ /admin/connectors เพื่อเพิ่ม`,
    not_connected: `Connector "${slug}" ยังไม่ผ่านการ Test (Connect→Register→Test) — ตรวจสอบ config/secret แล้วกด Test ที่ /admin/connectors`,
    not_enabled: `Connector "${slug}" ผ่าน Test แล้วแต่ยังไม่ได้ Enable — ต้องกด Enable เองที่ /admin/connectors (ไม่มี auto-enable)`,
  };
  return { ok: false, error: messages[stage], connector_slug: slug, stage };
}
