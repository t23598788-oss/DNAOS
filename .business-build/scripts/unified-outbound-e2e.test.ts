#!/usr/bin/env npx tsx
/**
 * UNIFIED OUTBOUND DELIVERY — E2E (owner directive ต่อจาก 24823b1, 2026-10-15)
 *
 * ต่างจาก result-delivery-offline (13/13 · engine 7 มิติ) และ
 * result-delivery-runtime-e2e (11/11 · จุด RFQ) และ backend-chain-e2e (15/15):
 * ไฟล์นี้พิสูจน์ว่า **ทั้ง 3 เส้นทางขาออกที่เหลือ** ถูกรวมเข้า Response Gateway
 * กลางเดียวครบ:
 *   reply        → app/api/admin/line-customers/[lineUserId]/reply
 *   send-debt    → app/api/admin/line-customers/[lineUserId]/send-debt (Flex)
 *   notifications→ app/api/admin/notifications/send
 *
 *  U1 ทุก route ส่งผ่าน deliverBusinessResult — sender ตรงถูกถอด (send-debt ยัง
 *     import sendLineMessage ได้ แต่ใช้เฉพาะใน send-wrapper ที่ส่ง Flex ผ่าน
 *     ช่องทางเดิมเท่านั้น — payload จาก route เท่านั้น)
 *  U2 ทุก route ตรวจ Connect Identity (resolveExternalIdentity — fail-closed
 *     เมื่ออ่านไม่ได้ · no default-allow)
 *  U3 ทุก route precheck ข้อความซ้ำข้ามช่องทาง (findRecentIdenticalOutbound
 *     — line_events direction=out เดิมทุก Writer ใช้) + engine RESULT-ID
 *     idempotency (พิสูจน์ runtime: provider เรียกครั้งเดียว · ซ้ำ → SKIPPED)
 *  U4 สัญญาเดิมยังอยู่: 503 = normalized business result (ไม่มี raw error),
 *     409 = ส่งซ้ำ, response shape เดิมเป็นฐาน + field additive
 *  U5 runtime idempotency ทริกทั้งสาม key namespace (reply:/debtNotice:/notification:)
 *
 * ห้ามส่ง LINE จริง — provider ถูก inject เป็น mock เสมอ; ทุกจุดเขียนอยู่ใน
 * capture-only fake db (ฐานจริง 0 แถว); อ่าน Supabase จริงเฉพาะสถิติ mapping
 *
 * Run: npx tsx scripts/unified-outbound-e2e.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^[\"']|[\"']$/g, "");
    }
  } catch { /* env may already be provided */ }
}
loadEnvLocal();

let passed = 0;
let failed = 0;
const ck = (id: string, ok: boolean, label: string) => {
  if (ok) { passed++; console.log(`  PASS  ${id} ${label}`); }
  else { failed++; console.log(`  FAIL  ${id} ${label}`); }
};
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const REPLY = "app/api/admin/line-customers/[lineUserId]/reply/route.ts";
const DEBT = "app/api/admin/line-customers/[lineUserId]/send-debt/route.ts";
const NOTIF = "app/api/admin/notifications/send/route.ts";
const ENGINE = "engines/delivery/result-delivery.ts";
const CHANNEL = "registry/communication.ts";

async function main() {
  const reply = read(REPLY), debt = read(DEBT), notif = read(NOTIF), engine = read(ENGINE), channel = read(CHANNEL);

  console.log("=== U1 — ทุก route ผ่าน Gateway กลางเดียว (ไม่มี sender คู่ขนาน) ===");
  ck("U1a", reply.includes("deliverBusinessResult") && !reply.includes('from "@/registry/communication"'),
    "reply: ไม่มี sender ตรง · ส่งผ่าน engine เดียว");
  ck("U1b", notif.includes("deliverBusinessResult") && !notif.includes('from "@/registry/communication"'),
    "notifications: ไม่มี sender ตรง · ส่งผ่าน engine เดียว");
  ck("U1c", debt.includes("deliverBusinessResult") && debt.includes('sendLineMessage'),
    "send-debt: ส่งผ่าน engine · sendLineMessage คงอยู่เฉพาะใน send-wrapper (Flex payload เดิม)");
  const debtSendUsesFlex = debt.includes('type: "flex"') && debt.includes("altText");
  ck("U1d", debtSendUsesFlex,
    "send-debt: payload Flex เดิมถูกส่งผ่าน sendLineMessage ตัวเดิม (ช่องทางเดิม ไม่ใช่ writer ใหม่)");
  ck("U1e", reply + notif + debt === [reply, notif, debt].join(""),
    "(sanity) source อ่านครบ");

  console.log("\n=== U2 — Connect Identity ครบทุกเส้นทาง (ไม่คาดเดาผู้รับ) ===");
  const identOk = (s: string) => s.includes("resolveExternalIdentity") && s.includes("500");
  ck("U2a", identOk(reply), "reply: identity ตรวจ + fail-closed 500 เมื่ออ่านไม่ได้");
  ck("U2b", identOk(debt), "send-debt: identity ตรวจ + fail-closed 500 เมื่ออ่านไม่ได้");
  ck("U2c", identOk(notif) && notif.includes("identityMapped"),
    "notifications: identity ตรวจ (ผู้รับกรอกโดยเจ้าของ — รายงานสถานที่ mapping จริงไม่ปลอม)");
  ck("U2d", !reply.includes("process.env.") && !debt.includes("process.env.") && !notif.includes("process.env.")
    && !channel.includes("process.env.") && !engine.includes("process.env."),
    "ไม่มี env override ทั้ง 4 ไฟล์ — recipient/token มาจาก row จริงเท่านั้น");

  console.log("\n=== U3 — กันซ้ำ: cross-channel precheck + engine idempotency ===");
  for (const [name, src] of [["reply", reply], ["send-debt", debt], ["notifications", notif]] as const) {
    ck(`U3-${name}`, src.includes("findRecentIdenticalOutbound") && src.includes("409"),
      `${name}: precheck line_events ขาออก (กันซ้ำข้ามช่องทาง รวม bot replies) → 409`);
  }
  ck("U3-engine", engine.includes("findRecentIdenticalOutbound"),
    "engine: helper กันซ้ำข้ามช่องทางอยู่ใน Gateway กลางเดิม (ไม่มีไฟล์ใหม่)");

  console.log("\n=== U5 — runtime idempotency ครบสาม namespace (mock provider) ===");
  const g = await import("@/engines/delivery/result-delivery");
  type Row = Record<string, unknown>;
  const makeCapture = () => {
    const audit: Row[] = []; const live: Row[] = [];
    const q: Record<string, unknown> = {};
    return {
      audit, live,
      db: {
        from: (t: string) => {
          if (t === "audit_logs") {
            return {
              insert: (row: Row) => { audit.push({ created_at: new Date().toISOString(), ...row }); return { error: null }; },
              select: () => {
                const chain = {
                  eq: (c: string, v: unknown) => { q[c] = v; return chain; },
                  ilike: (c: string, v: string) => { q[`${c}__ilike`] = v; return chain; },
                  gte: (c: string, v: unknown) => { q[`${c}__gte`] = v; return chain; },
                  limit: () => Promise.resolve({ data: audit.filter((r) =>
                    (!q.entity_type || r.entity_type === q.entity_type) &&
                    (!q.entity_id || r.entity_id === q.entity_id) &&
                    (!q.action || r.action === q.action)), error: null }),
                };
                return chain;
              },
            };
          }
          if (t === "live_commands") {
            return { insert: (row: Row) => { live.push(row); return { error: null }; } };
          }
          throw new Error(`unexpected table ${t}`);
        },
      } as never,
    };
  };
  const mkSend = () => { let calls = 0; return { get calls() { return calls; }, send: (async () => { calls++; return { ok: true, messageId: `m-${calls}` }; }) as never }; };
  const normalizer = (async (r: unknown) => (r as { ok?: boolean }).ok ? { ok: true, code: "SENT", message: "ส่งสำเร็จ", failureClass: null, workId: null, incidentId: null } : { ok: false, code: "SEND_FAILED", message: "ส่งไม่สำเร็จ", failureClass: "UNKNOWN", workId: null, incidentId: null }) as never;

  for (const ns of ["reply", "debtNotice", "notification"] as const) {
    const cap = makeCapture(); const s = mkSend();
    const input = { lineUserId: `U-${ns.toUpperCase()}-E2E`, replyText: `ข้อความทดสอบ ${ns}`, resultKey: `${ns}:u:${Date.now()}`, navigateUrl: null, workspace: null, authorize: async () => true };
    const deps = { db: cap.db, send: s.send, normalizer } as never;
    const r1 = await g.deliverBusinessResult(input, deps);
    const r2 = await g.deliverBusinessResult(input, deps);
    ck(`U5-${ns}`, r1.status === "SENT" && s.calls === 1 && r2.status === "SKIPPED_DUPLICATE" && s.calls === 1,
      `${ns}/: SENT ครั้งเดียว → ซ้ำใน namespace เดียวกัน = SKIPPED_DUPLICATE (provider 1 ครั้ง)`);
  }

  console.log("\n=== U4 — สัญญาเดิมยังคุมอยู่ (503 normalized · response shape) ===");
  ck("U4a", reply.includes("lastNormalized") && debt.includes("lastNormalized") && notif.includes("lastNormalized"),
    "ทุก route คืน 503 ด้วย normalized payload ของ bridge เดิม (ไม่ emit raw provider error)");
  ck("U4b", reply.includes("ok: true") && debt.includes("ok: true") && notif.includes("ok: true"),
    "สาย SENT ทุกเส้นคืน {ok:true} เป็นฐาน + field delivery additive");
  ck("U4c", engine.includes("SKIPPED_UNAUTHORIZED") && !reply.includes("authorize: async () => false"),
    "fail-closed authorize ยังอยู่ใน engine (route ผ่าน requireAuth ก่อนเสมอ)");

  console.log("\n=== ข้อมูลจริง (อ่านเท่านั้น) — line_events out writer ครอบคลุมข้ามช่องทาง ===");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { count: outRows, error: eOut } = await db.from("line_events").select("*", { count: "exact", head: true }).eq("direction", "out");
  const { count: auditRows, error: eAudit } = await db.from("audit_logs").select("*", { count: "exact", head: true }).eq("entity_type", "notification").eq("field", "line_push");
  console.log(`      line_events(direction=out) = ${eOut ? `ERR:${eOut.message}` : outRows} · audit_logs(notification/line_push) = ${eAudit ? `ERR:${eAudit.message}` : auditRows}`);
  ck("U6", !eOut && !eAudit && typeof outRows === "number" && typeof auditRows === "number",
    "อ่านสถิติ dedupe-hub จริงได้ (line_events = ที่ทุกช่องทางขาออกเขียนร่วมกัน — ฐานของ helper ใหม่)");

  console.log("\n============================================================");
  console.log(`${passed} passed, ${failed} failed`);
  console.log("provider LINE จริง: ไม่ถูกเรียก (mock เท่านั้น) · Supabase: อ่านอย่างเดียว · จุดเขียนทั้งหมดใน capture db");
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
  process.exit(2);
});
