#!/usr/bin/env npx tsx
/**
 * RESULT DELIVERY — MOCK PROVIDER OFFLINE TEST (PHASE 2, owner directive 2026-10-15)
 *
 * พิสูจน์ 7 มิติด้วย Mock Provider (deps inject เดิมทุกตัว — provider LINE จริงไม่ถูกเรียก
 * ใน test นี้เลย จึงปลอดภัยตามโจทย์ "ทดสอบด้วย Mock Provider ก่อน"):
 *   T1 Message Identity / T2 Recipient Mapping / T3 Capability Authorization (fail-closed)
 *   T4 Delivery Status / T5 Retry (5xx retry เดียว · auth ไม่ retry) / T6 Idempotency
 *   T7 Audit + live_commands (คอลัมน์เดิมตาม app/api/internal/line/command)
 *
 * Run: npx tsx scripts/result-delivery-offline-test.ts
 */
import assert from "node:assert/strict";
import type { DeliveryDeps } from "@/engines/delivery/result-delivery";
import type { NormalizedBusinessResult } from "@/app/api/admin/ide/_lib/businessFailureBridge";

type Row = Record<string, unknown>;

/** fake Supabase-like chain ที่ engine ใช้จริงเท่านั้น (audit_logs insert/select-chain, live_commands insert) */
function makeDb() {
  const auditRows: Row[] = [];
  const liveRows: Row[] = [];
  const build = (table: string) => {
    if (table === "audit_logs") {
      return {
        insert: (row: Row) => {
          auditRows.push({ created_at: new Date().toISOString(), ...row });
          return { error: null } as unknown;
        },
        select: (__cols: string) => {
          const q: Record<string, unknown> = {};
          const chain = {
            eq: (col: string, val: unknown) => {
              q[col] = val;
              return chain;
            },
            ilike: (col: string, val: string) => {
              q[`${col}__ilike`] = val;
              return chain;
            },
            gte: (col: string, val: unknown) => {
              q[`${col}__gte`] = val;
              return chain;
            },
            limit: (_n: number) =>
              Promise.resolve({ data: auditRows.filter((r) => matchRow(r, q)), error: null }),
          };
          return chain;
        },
      } as unknown as never;
    }
    if (table === "live_commands") {
      return {
        insert: (row: Row) => {
          liveRows.push(row);
          return { error: null } as unknown;
        },
      } as unknown as never;
    }
    throw new Error(`unexpected table ${table}`);
  };
  function matchRow(r: Row, q: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(q)) {
      if (k.endsWith("__ilike")) {
        const pat = String(v).replace(/%/g, "");
        if (!String(r[k.replace("__ilike", "")] ?? "").includes(pat)) return false;
      } else if (k.endsWith("__gte")) {
        const val = String(r[k.replace("__gte", "")] ?? "");
        if (!(val >= String(v))) return false; // เทียบเชิงวันชาติเดียวกับ supabase gte
      } else if (String(r[k] ?? "") !== String(v)) return false;
    }
    return true;
  }
  return { db: { from: build } as never, auditRows, liveRows };
}

interface MockCall { to: string; messages: unknown[] }

function makeSend(script: Array<"ok" | "fail5xx" | "failAuth">): { calls: MockCall[]; send: never } {
  const calls: MockCall[] = [];
  let i = 0;
  const send = async (db: unknown, to: string, messages: unknown[]) => {
    calls.push({ to, messages });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === "fail5xx") return { success: false, error: "LINE API Error 503: upstream unavailable" };
    if (step === "failAuth") return { success: false, error: "LINE API Error 401: unauthorized (test)" };
    return { success: true, messageId: `MSG-${++i}-MOCK` };
  };
  return { calls, send: send as never };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let passed = 0;
  const failed: string[] = [];
  const check = (label: string, ok: boolean) => {
    if (ok) {
      passed += 1;
      console.log(`  PASS  ${label}`);
    } else {
      failed.push(label);
      console.log(`  FAIL  ${label}`);
    }
  };

  // ── ฉบับสำรวกรร่วม: normalizer จำลองสเปกเดียวกับ businessFailureBridge (ไม่แตะ incident infra ของจริง)
  const normalizer: DeliveryDeps["normalizer"] = async (send, _input) => {
    const ok: NormalizedBusinessResult = {
      ok: true,
      code: "SENT",
      message: "ส่งสำเร็จ",
      failureClass: null,
      workId: null,
      incidentId: null,
    };
    if (send.success) return ok;
    const failed: NormalizedBusinessResult = {
      ok: false,
      code: "INFRASTRUCTURE_BLOCKED",
      message: "ส่งไม่สำเร็จ",
      failureClass: /40[13]/.test(send.error ?? "") ? "PROVIDER_AUTH" : "PROVIDER_UNAVAILABLE",
      workId: "wf-mock",
      incidentId: "inc-mock",
    };
    return failed;
  };

  // ── T1/T2/T7 ส่งสำเร็จตรง ๆ
  {
    const { db, auditRows, liveRows } = makeDb();
    const { calls, send } = makeSend(["ok"]);
    const { deliverBusinessResult } = await import("@/engines/delivery/result-delivery");
    const res = await deliverBusinessResult(
      {
        lineUserId: "UtestRecipient001",
        replyText: "ยืนยันสลิป 100 บาทสำเร็จ (ผลจาก Business Engine)",
        resultKey: "RECEIPT:abc-001",
        navigateUrl: "/admin/receipts",
        workspace: "finance",
        authorize: () => true,
      },
      { db, send, normalizer, now: () => new Date("2026-10-15T10:00:00Z") },
    );
    check("T4a Delivery Status = SENT", res.status === "SENT");
    check("T5b single attempt เมื่อส่งสำเร็จครั้งแรก", res.attempts === 1);
    check("T1 Message Identity — messageId จาก provider assignable", res.messageId === "MSG-1-MOCK");
    check("T2 Recipient Mapping — push ไปที่ lineUserId ของผลธุรกิจ", calls[0]?.to === "UtestRecipient001");
    check("T7a audit_logs มีแถว sent พร้อม RESULT-ID", auditRows.some(
      (r) => r.action === "sent" && String(r.new_value ?? "").startsWith("RESULT-ID:RECEIPT:abc-001"),
    ));
    check("T7b live_commands row คอลัมน์เดิมตาม bridge เดิม", liveRows.length === 1
      && "line_user_id" in liveRows[0] && "reply_text" in liveRows[0] && "navigate_url" in liveRows[0]);
  }

  // ── T3 fail-closed authz
  {
    const { db, auditRows, liveRows } = makeDb();
    const { calls, send } = makeSend(["ok"]);
    const { deliverBusinessResult } = await import("@/engines/delivery/result-delivery");
    const res = await deliverBusinessResult(
      {
        lineUserId: "UtestRecipient001",
        replyText: "x",
        resultKey: "R:unauth",
        authorize: () => false,
      },
      { db, send, normalizer, now: () => new Date("2026-10-15T10:01:00Z") },
    );
    check("T3 Capability Auth fail-closed → SKIPPED_UNAUTHORIZED", res.status === "SKIPPED_UNAUTHORIZED");
    check("T3b ไม่แตะ provider/audit เมื่อไม่ผ่านสิทธิ์", calls.length === 0 && auditRows.length === 0 && liveRows.length === 0);
  }

  // ── T5a retry: 5xx แล้วสำเร็จ (พยายาม = 2)
  {
    const { db } = makeDb();
    const { calls, send } = makeSend(["fail5xx", "ok"]);
    const { deliverBusinessResult } = await import("@/engines/delivery/result-delivery");
    const res = await deliverBusinessResult(
      { lineUserId: "Ure", replyText: "r", resultKey: "R:retry5xx", authorize: () => true },
      { db, send, normalizer, now: () => new Date("2026-10-15T10:02:00Z") },
    );
    check("T5 Retry — 5xx ครั้งแรก แล้วสำเร็จครั้งเดียวถัดไป (attempts=2)", res.status === "SENT" && res.attempts === 2 && calls.length === 2);
  }

  // ── T5c auth error → ไม่ retry
  {
    const { db } = makeDb();
    const { send } = makeSend(["failAuth"]);
    const { deliverBusinessResult } = await import("@/engines/delivery/result-delivery");
    const res = await deliverBusinessResult(
      { lineUserId: "Ure", replyText: "r", resultKey: "R:authfail", authorize: () => true },
      { db, send, normalizer, now: () => new Date("2026-10-15T10:03:00Z") },
    );
    check("T5c auth/mapping error ไม่ retry (หยุดครั้งเดียว)", res.status === "FAILED" && res.attempts === 1);
  }

  // ── T6 idempotency: sent แล้ว เรียกซ้ำไม่ยิง provider
  {
    const { db, auditRows } = makeDb();
    const { calls, send } = makeSend(["ok", "ok"]);
    const { deliverBusinessResult } = await import("@/engines/delivery/result-delivery");
    const inp = { lineUserId: "Uid", replyText: "ยืดกลับเดิม", resultKey: "R:same-key", authorize: () => true } as never;
    const first = await deliverBusinessResult(inp as never, { db, send, normalizer, now: () => new Date("2026-10-15T10:04:00Z") });
    await wait(5);
    const second = await deliverBusinessResult(inp as never, { db, send, normalizer, now: () => new Date("2026-10-15T10:04:30Z") });
    check("T6 Idempotency — resultKey เดิมภายใน 24 ชม. → SKIPPED_DUPLICATE", first.status === "SENT" && second.status === "SKIPPED_DUPLICATE");
    check("T6b provider ถูกเรียกครั้งเดียวเท่านั้น", calls.length === 1);
    check("T6c audit แถว sent ไม่ซ้ำสอง", auditRows.filter((r) => r.action === "sent").length === 1);
  }

  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    console.log("FAILED:", failed.join(", "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
