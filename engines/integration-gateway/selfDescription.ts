/**
 * Integration Gateway — Self Description (owner, 2026-08-05).
 * Real, hand-maintained record of what this layer actually does today —
 * not aspirational. Read by the Control Environment page (and anything else
 * that wants to show gateway status) instead of that UI hardcoding its own
 * copy of "which adapters/channels exist" — the UI calls the Gateway and
 * displays what it returns, per explicit instruction that no connection
 * logic lives in the page itself.
 */
import { channelIsEnabled } from "./policy/gate";
import type { GatewayChannel, GatewayProvider } from "./contracts/event";

export interface AdapterDescription {
  provider: GatewayProvider;
  observes: string[];
  ingress: "webhook" | "poll";
}

export const ADAPTERS: AdapterDescription[] = [
  { provider: "github", observes: ["repository", "branch", "commit", "pull_request", "workflow_run"], ingress: "webhook" },
  { provider: "supabase", observes: ["health", "migration_state"], ingress: "poll" },
  { provider: "vercel", observes: ["deployment"], ingress: "webhook" },
  { provider: "railway", observes: ["deployment"], ingress: "webhook" },
];

export const CHANNELS: { channel: GatewayChannel; enabled: boolean; description: string }[] = [
  { channel: "observe", enabled: channelIsEnabled("observe"), description: "อ่านสถานะและรับ Event อย่างเดียว — ไม่มีการเปลี่ยนแปลงใดๆ ในระบบจริง" },
  { channel: "propose", enabled: channelIsEnabled("propose"), description: "AI หรือระบบเสนอคำสั่ง แต่ยังไม่รัน — เปิดเมื่อ GitHub/Supabase/Vercel Observe ครบและเสถียร" },
  { channel: "execute", enabled: channelIsEnabled("execute"), description: "รันได้เฉพาะคำสั่งที่ Deploy Gate และ Owner อนุมัติแล้ว — เปิดทีหลังสุด" },
];

export function describeGateway() {
  return {
    layer: "engines/integration-gateway",
    role: "แปลภาษาและส่งต่อระหว่างระบบภายนอกกับ DNA OS Core — ไม่มี business logic ของตัวเอง",
    adapters: ADAPTERS,
    channels: CHANNELS,
  };
}
