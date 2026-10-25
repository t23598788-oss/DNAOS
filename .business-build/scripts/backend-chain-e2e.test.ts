#!/usr/bin/env npx tsx
/**
 * BACKEND CHAIN E2E (owner directive 2026-10-15, items 3+4+5) — one continuous
 * proven path, ZERO external sends, ZERO real business transactions:
 *
 *   AI Agent → AI Gateway (TTL lease) → Connect transport
 *     → Canonical Writer (row shape) → Supabase (real reads)
 *     → Result Delivery (Response Gateway) → LINE หยุดตรงขอบ fail-closed
 *
 * ขอบเขตตามโจทย์:
 *  - ขา LINE จริง **ไม่ถูกเรียก** — token/ผู้รับจริงไม่ใช้ ขั้นส่งจริงยังต้อง
 *    Owner-เลือกผู้รับก่อน (evidence: SKIPPED_UNAUTHORIZED / allowed fail path)
 *  - ไม่สร้างธุรกรรมจริง — ขา production ของ canonical writer (พิสูจน์แล้ว
 *    เป็น createBusinessEvent ตัวเดียว จุด M) รันผ่าน **sink** เท่านั้น
 *  - kv_cache/audit/live_commands ตัวทดสอบสร้างเอง ถูก **ลบ/จับหลักฐานครบทุกเคส**
 *
 * Run: npx tsx scripts/backend-chain-e2e.test.ts
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
const failures: string[] = [];
const ck = (id: string, ok: boolean, label: string) => {
  if (ok) { passed += 1; console.log(`  PASS  ${id} ${label}`); }
  else { failures.push(id); console.log(`  FAIL  ${id} ${label}`); }
};

const leaseKeys: string[] = [];

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const real = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const gateway = await import("@/gateway/actions");
  const writer = await import("@/engines/transport/driver-workflow");
  const canonical = await import("@/engines/canonical/event-write");
  const delivery = await import("@/engines/delivery/result-delivery");

  console.log("\n=== ขั้น 1 — AI Agent Gateway: Capability Lease TTL (ของเดิม: preview_token บน kv_cache 5 นาที) ===");
  const leaseKeyOf = (t: string) => `preview_token:${t}`;

  // 1a. ออกใบ lease จริง → persist บน kv_cache จริง พร้อม TTL ≤ 5 นาที
  const token1 = await gateway.issueToken("payment", { probe: "e2e-lease" });
  leaseKeys.push(leaseKeyOf(token1));
  const { data: row1 } = await real.from("kv_cache").select("key, value").eq("key", leaseKeyOf(token1)).maybeSingle();
  const entry1 = (row1?.value ?? null) as { action?: string; payload?: Record<string, unknown>; expires?: number } | null;
  ck("L1", !!row1 && entry1?.action === "payment" && entry1?.payload?.probe === "e2e-lease"
    && (entry1?.expires ?? 0) > Date.now() && (entry1?.expires ?? 0) <= Date.now() + 6 * 60 * 1000,
    "lease persist บน kv_cache จริง + TTL ภายใน 5 นาที");

  // 1b. fail-closed: persist ไม่ได้ = ต้องไม่ดูเหมือนออกใบได้
  gateway.__setTokenDbForTest({ from: () => ({ upsert: async () => ({ error: { message: "simulated store unavailable" } }) }) } as any);
  let storeFailed = "";
  try { await gateway.issueToken("payment", {}); } catch (e) { storeFailed = e instanceof Error ? e.message : String(e); }
  gateway.__setTokenDbForTest(null); // คืน DB จริงเสมอ
  ck("L2", storeFailed.startsWith("PREVIEW_TOKEN_STORE_FAILED"), `store fail → fail-closed (${storeFailed.slice(0, 44)})`);

  // 1c. action ไม่ตรงกับใบ lease = ปฏิเสธ
  const wrong = await gateway.consumeToken(token1, "document.create");
  ck("L3", !wrong.valid && String(wrong.error).includes("token ออกให้"), `action mismatch ปฏิเสธ (${String(wrong.error).slice(0, 44)})`);

  // 1d. ในกรอบเวลา → claim ได้ครั้งเดียว
  const ok1 = await gateway.consumeToken(token1, "payment");
  ck("L4", ok1.valid === true, "consume ในกรอบเวลา → valid");

  // 1e. claim ครั้งที่สอง = ต้องปฏิเสธเสมอ (single-use) — sequential consume
  //     ตัว row ถูกลบไปแล้วจึงได้ข้อความ "ไม่ถูกต้องหรือหมดอายุ"; branch
  //     "ถูกใช้ไปแล้ว" คือกรณี race ข้าม instance (DELETE…RETURNING แข่งขัน)
  const ok2 = await gateway.consumeToken(token1, "payment");
  ck("L5", !ok2.valid && (String(ok2.error).includes("ถูกใช้ไปแล้ว") || String(ok2.error).includes("ไม่ถูกต้องหรือหมดอายุ")), `single-use: ใช้ซ้ำปฏิเสธ (${String(ok2.error).slice(0, 40)})`);

  // 1f. หมดอายุ (เลื่อน expires เป็นอดีตบนแถวที่ตัวทดสอบสร้างเอง) → ปฏิเสธ + แถวถูกลบจริง
  const token2 = await gateway.issueToken("debt.create", { probe: "e2e-lease-exp" });
  leaseKeys.push(leaseKeyOf(token2));
  await real.from("kv_cache").update({ value: { action: "debt.create", payload: { probe: "e2e-lease-exp" }, expires: Date.now() - 1000 } }).eq("key", leaseKeyOf(token2));
  const ok3 = await gateway.consumeToken(token2, "debt.create");
  const { data: rowAfter } = await real.from("kv_cache").select("key").eq("key", leaseKeyOf(token2)).maybeSingle();
  ck("L6", !ok3.valid && String(ok3.error).includes("หมดอายุ") && !rowAfter, "TTL หมดอายุ → ปฏิเสธ + no residue");

  console.log("\n=== ขั้น 2 — Connect transport → Canonical Writer (row shape ตัวเดียว · sink เท่านั้น) ===");
  const canonicalRows: Record<string, unknown>[] = [];
  writer.setLocalEventSink(async (_t: string, row: Record<string, unknown>) => { canonicalRows.push(row); });
  writer.setAuthorizeOverrideForTest(async () => ({ ok: true }) as any);
  writer.setSupabaseClient(real as any); // ขาอ่านจริงผ่าน client เดิมเสมอ (Rule 71)
  const written = await writer.recordTransportEvent({
    lineUserId: "U-SIM-CHAIN-E2E",
    jobId: "chain-e2e-probe",
    eventType: "DELIVERY_CONFIRMED",
    nonce: `chain-e2e-${Date.now()}`,
  });
  const probe = canonical.buildBusinessEventRow({
    eventCode: "driver.delivery_confirmed",
    eventType: "transport",
    eventDate: new Date().toISOString().slice(0, 10),
    title: "รถ: DELIVERY_CONFIRMED",
    description: "job=chain-e2e-probe",
    source: { provider: "line", externalSubjectId: "U-SIM-CHAIN-E2E" },
    context: { job_id: "chain-e2e-probe", gps: null, verification: undefined },
    metadata: { recorded_by: "driver-workflow" },
    actor: "driver-workflow",
  });
  ck("C1", written.ok === true && canonicalRows.length === 1, "เหตุการณ์ transport ผ่าน Connect transport รันถึง canonical writer (sink เท่านั้น)");
  const writtenBy = String((canonicalRows[0] as any)?.metadata?.written_by ?? "");
  ck("C2", writtenBy.startsWith("canonical:event-write@"), `row ผูก metadata writer เดียว (${writtenBy})`);
  ck("C3", canonicalRows.length === 1 && Object.keys(probe).every((k) => k in canonicalRows[0]), "row shape เป๊ะจาก builder ตัวเดียว (event_code/source_line_user_id/status/…)");

  console.log("\n=== ขั้น 3 — Result Delivery (ขอบ LINE: fail-closed · ไม่ยิง provider จริง) ===");
  // 3a. สิทธิ์ไม่ผ่าน → SKIPPED ก่อนแตะ DB/Provider (deps จริงทั้งขา)
  const unauth = await delivery.deliverBusinessResult(
    { lineUserId: "U-SIM-CHAIN-E2E", replyText: "ทดสอบ", resultKey: `chain-e2e-unauth-${Date.now()}`, authorize: async () => false },
  );
  ck("R1", unauth.status === "SKIPPED_UNAUTHORIZED" && unauth.attempts === 0, "สิทธิ์ fail-closed → SKIPPED (attempts=0 · provider ไม่ถูกแตะ)");

  // 3b. provider จริงไม่พร้อม (503 จำลองตรง class เดิม) → FAILED + retry ครั้งเดียว
  const captured: { audit: any[]; live: any[] } = { audit: [], live: [] };
  const captureDb = {
    from: (_t: string) => ({
      select: () => {
        const q: any = { eq: () => q, ilike: () => q, gte: () => q, limit: async () => ({ data: [], error: null }) };
        return q;
      },
      insert: (row: Record<string, unknown>) => {
        if (row.entity_type === "notification" && row.field === "line_push") captured.audit.push(row);
        else if ("reply_text" in row) captured.live.push(row);
        return { then: undefined };
      },
      delete: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
    }),
  } as any;
  const failed = await delivery.deliverBusinessResult(
    { lineUserId: "U-SIM-CHAIN-E2E", replyText: "ทดสอบผลลัพธ์", resultKey: `chain-e2e-fail-${Date.now()}`, authorize: async () => true, navigateUrl: null, workspace: null },
    {
      db: captureDb,
      send: (async () => ({ ok: false, error: { status: 503 } })) as any,
      normalizer: (async (res: any) => ({ ok: false, failureClass: res?.error?.status === 503 ? "PROVIDER_UNAVAILABLE" : "UNKNOWN" })) as any,
    },
  );
  ck("R2", failed.status === "FAILED" && failed.failureClass === "PROVIDER_UNAVAILABLE" && failed.attempts === 2,
    "provider ไม่พร้อม → FAILED/PROVIDER_UNAVAILABLE · retry ครั้งเดียวจบ");
  ck("R3", captured.audit.length === 2 && captured.audit.every((a) => a.action === "failed" && String(a.new_value).startsWith("RESULT-ID:")),
    "ทุก attempt ผ่าน audit_logs เดิม (RESULT-ID idempotency key)");

  // 3c. สายอนุมัติ (injected send จริงใจไม่ยิง LINE) → SENT + audit sent + live_commands บ่อเดิม
  const sent = await delivery.deliverBusinessResult(
    { lineUserId: "U-SIM-CHAIN-E2E", replyText: "ผลการทำงานจบแล้ว (ทดสอบ)", resultKey: `chain-e2e-sent-${Date.now()}`, authorize: async () => true },
    {
      db: captureDb,
      send: (async () => ({ ok: true, messageId: "m-e2e-1" })) as any,
      normalizer: (async () => ({ ok: true })) as any,
    },
  );
  const audRows = captured.audit.filter((a) => a.action === "sent");
  ck("R4", sent.status === "SENT" && sent.messageId === "m-e2e-1" && sent.attempts === 1, "สายอนุมัติ → SENT + messageId (identity ของข้อความ)");
  ck("R5", audRows.length === 1 && captured.live.length === 1 && captured.live[0].line_user_id === "U-SIM-CHAIN-E2E" && "reply_text" in captured.live[0],
    "SENT ติด audit(sent) 1 แถว + ลง live_commands คอลัมน์เดิม (บอร์ดที่ realtime อยู่เห็น)");

  console.log("\n=== ขั้น 4 — เก็บกวาดหลักฐาน (lease keys ที่ทดสอบนี้สร้าง) ===");
  let cleaned = 0;
  for (const key of leaseKeys) {
    const { error } = await real.from("kv_cache").delete().eq("key", key);
    if (!error) cleaned++;
  }
  ck("Z1", cleaned === leaseKeys.length, `ลบ lease keys ของตัวเองครบ (${cleaned}/${leaseKeys.length})`);

  console.log("\n============================================================");
  console.log(`${passed} passed, ${failures.length} failed`);
  console.log("LINE จริง: ไม่ถูกเรียก · ธุรกรรมจริง: ไม่เกิด · row/audit/live_commands ของทดสอบอยู่ใน capture เท่านั้น · kv_cache ลบครบ");
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
  process.exit(2);
});
