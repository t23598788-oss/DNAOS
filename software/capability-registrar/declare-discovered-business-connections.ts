/**
 * หน้าที่: ผูก capability ธุรกิจที่เพิ่งลงทะเบียน เข้ากับ "ที่อยู่ที่ตอบจริง"
 * ผ่าน connection-registry เดิม เพื่อให้ชั้น capability-route หามันเจอ
 * (Owner, 2026-09-02 — DISCOVERY, ไม่ใช่ implementation ใหม่).
 *
 * ประกาศเฉพาะสิ่งที่วัดแล้วว่าตอบจริง. deadboard Next.js API ไม่ถูกประกาศ
 * เพราะไม่มี runtime ที่ไหนเลย (Vercel 402, job local ดับ, ไม่มีพอร์ตฟัง) การ
 * ประกาศที่อยู่ให้มันจะทำให้ route ชี้ไปที่ที่ไม่มีใครรับ ซึ่งแย่กว่าการบอกว่า
 * ยังไม่มีที่อยู่
 *
 * state = OBSERVED ไม่ใช่ PROVEN. วัดได้แค่ว่า endpoint ตอบกลับมา ยังไม่ได้
 * พิสูจน์ว่าเรียกใช้งานได้จริงด้วย credential — PROVEN ต้องมี evidence id และ
 * ยังไม่มี
 *
 * Usage: npx tsx software/capability-registrar/declare-discovered-business-connections.ts
 */
import { registerConnectionDeclaration } from "../../connections/connection-registry/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { resolveRouteFromDisk } from "../../control/capability-route/host-runtime";

const PROJECT = "xeytcavxejhyzxwevgto";

function main(): number {
  const store = createPersistentFileStore();
  const want = [
    {
      capability: "line-messaging-production",
      connection_type: "TOOL_INGRESS" as const,
      direction: "BIDIRECTIONAL" as const,
      protocol: "HTTPS_WEBHOOK" as const,
      endpoint: `https://${PROJECT}.supabase.co/functions/v1/line-webhook-v2`,
      execution_boundary: "~/Desktop/dna-os-deadboard/supabase/functions/line-webhook-v2/index.ts",
      measured: "HTTP 400 (function answered without a valid signed payload) — measured 2026-09-02",
    },
    {
      capability: "business-entity-registry",
      connection_type: "INFRASTRUCTURE_PROVIDER" as const,
      direction: "OUTBOUND" as const,
      protocol: "HTTPS_REST" as const,
      endpoint: `https://${PROJECT}.supabase.co/rest/v1/`,
      execution_boundary: "~/Desktop/dna-os-deadboard/supabase/migrations/ (entity_registry, company_line_links, conversation_states)",
      measured: "HTTP 401 (project reachable, API key required) — measured 2026-09-02",
    },
  ];

  let bad = 0;
  for (const w of want) {
    const cap = findCapability({ canonical_name: w.capability }, store);
    if (!cap) { console.log(`  ${w.capability}: NO CANONICAL IDENTITY — skipped`); bad += 1; continue; }
    const result = registerConnectionDeclaration({
      connection_type: w.connection_type,
      direction: w.direction,
      source_id: "dna-os-infrastructure",
      provider_id: "supabase",
      target_descriptor: { project_ref: PROJECT, surface: w.protocol === "HTTPS_WEBHOOK" ? "edge-function" : "postgrest" },
      // ผูกกับตัวตน canonical จริง — invariant ของทะเบียนนี้คือ RESOLVED ได้ก็ต่อเมื่อมี id
      canonical_target_id: cap.capability_id,
      target_resolution: "RESOLVED",
      protocol: w.protocol,
      endpoint: w.endpoint,
      execution_boundary: w.execution_boundary,
      executor_capability_id: cap.capability_id,
      // ยังไม่ได้ยืนยันว่ามี credential ตัวไหนสำหรับเส้นนี้ จึงไม่แต่งตัวชี้ขึ้นมา
      credential_ref: { kind: "not_yet_built" },
      credential_scope: [],
      configuration_source: "measured probe 2026-09-02",
      state: "OBSERVED",
    } as never);
    console.log(`\n  ${w.capability}`);
    console.log(`    declaration : ${result.status}${result.reasons.length ? ` ${JSON.stringify(result.reasons)}` : ""}`);
    console.log(`    endpoint    : ${w.endpoint}`);
    console.log(`    measured    : ${w.measured}`);
    const route = resolveRouteFromDisk(w.capability);
    console.log(`    route       : ${route.outcome}${route.route ? ` -> ${route.route.address}` : ""}`);
    if (result.status === "REJECTED") bad += 1;
  }
  return bad === 0 ? 0 : 1;
}
process.exit(main());
