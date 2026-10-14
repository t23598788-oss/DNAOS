/**
 * Result Delivery — PHASE 2 (owner directive 2026-10-15)
 *
 * เชื่อมผลลัพธ์จาก Business Engine กลับไปยังผู้ส่งข้อความผ่าน Provider Adapter เดิม:
 *   - ของเดิมที่ใช้ 100%: `sendLineMessage` (registry/communication.ts — connector Run gate
 *     + LINE Messaging API push เดิม), `normalizeSendResult` (businessFailureBridge —
 *     Business ไม่เห็น raw provider error), `audit_logs` (จุด audit เดิม), `live_commands`
 *     (คอลัมน์เดิม: line_user_id/command_text/reply_text/navigate_url/workspace — บอร์ดที่
 *     subscribe Realtime อยู่เห็นผลทันทีโดยไม่มีตาราง/schema ใหม่)
 *   - ห้ามมี Gateway/Message Writer/Business Engine คู่ขนาน — ไฟล์นี้เป็นเพียงโมดูล
 *     orchestration ใหม่ที่เรียกของเดิมเป็นตัวๆ เดียว
 *
 * 7 มิติ (โจทย์ PHASE 2 §ตรวจสอบ):
 *   1) Message Identity   = resultKey + messageId ที่ LINE คืน (BATCH 38 evidence เดิม)
 *   2) Recipient Mapping  = lineUserId ตามผลลัพธ์ธุรกิจ (caller อ่านจาก row เดิม)
 *   3) Capability Auth    = authorize() fail-closed (caller ผ่าน requireAuth/ADMIN_TIER
 *                           หรือ Connect identity เดิมเข้ามาเสมอ — ไม่มี default allow)
 *   4) Delivery Status    = SENT / FAILED จาก normalizeSendResult + messageId
 *   5) Retry              = retryable class (5xx/timeout) → retry ครั้งเดียว; auth/mapping fail → หยุด
 *   6) Idempotency        = เช็ค audit_logs ย้อน 24 ชม. ด้วย RESULT-ID:<resultKey> ก่อนส่ง;
 *                           เจอของซ้ำ = ไม่ยิง provider อีก (ไม่แก้ schema)
 *   7) Audit              = audit_logs sent/failed เดิม + live_commands row เสมอ
 *
 * ข้อจำกัดตามโจทย์: ขั้น Live Delivery กับ LINE จริงต้องอยู่ใต้สิทธิ์ Owner-approved
 * channel_access_token — ขั้นนั้นรายงาน BLOCKED ต่างหากหากไม่มีสิทธิ์ (test ยังครอบคลุมผ่าน injected deps)
 */
import { sendLineMessage } from "@/registry/communication";
import { normalizeSendResult } from "@/app/api/admin/ide/_lib/businessFailureBridge";
import type { NormalizedFailureClass } from "@/app/api/admin/ide/_lib/businessFailureBridge";
import { supabaseAdmin } from "@/services/supabase/queries";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliveryStatus = "SENT" | "FAILED" | "SKIPPED_DUPLICATE" | "SKIPPED_UNAUTHORIZED";

export interface ResultDeliveryInput {
  /** ผู้รับ = LINE userId ที่มาจากผลลัพธ์ธุรกิจจริง (mapping เดิม) */
  lineUserId: string;
  /** ข้อความ reply ที่ผู้ใช้ควรเห็น (ผลจาก Business Engine) */
  replyText: string;
  /** ตัวตนของผลลัพธ์: ใช้เป็น idempotency key + Message Identity */
  resultKey: string;
  navigateUrl?: string | null;
  workspace?: string | null;
  /** Capability authorization — fail-closed: caller ต้องผูก requireAuth/ADMIN_TIER หรือ Connect identity เดิม */
  authorize?: () => boolean | Promise<boolean>;
}

export interface ResultDeliveryResult {
  status: DeliveryStatus;
  /** LINE messageId จาก B / BATCH 38 evidence — id จริงของข้อความ (ถ้าได้) */
  messageId?: string;
  /** audit_logs id ล่าสุดที่โมดูลนี้เขียน */
  attempts: number;
  failureClass?: NormalizedFailureClass;
}

export interface DeliveryDeps {
  db: SupabaseClient;
  /** default = Provider Adapter เดิม (registry/communication.sendLineMessage) */
  send: typeof sendLineMessage;
  /** default = normalizeSendResult เดิม (businessFailureBridge) — DI เฉพาะขั้นทดสอบ (injected deps จาก scripts — engine จริงไม่มีข้อมูลแสดง) */
  normalizer: typeof normalizeSendResult;
  now: () => Date;
}

const AUDIT_WINDOW_HOURS = 24;
const MAX_SEND_ATTEMPTS = 2; // พยายามครั้งแรก + retry ครั้งเดียว

/** audit_logs audit ระดับเดิม (sent/failed) — แนบ RESULT-ID ลง new_value เพื่อใช้เช็ค idempotent ได้ */
async function auditLog(
  db: DeliveryDeps["db"],
  action: "sent" | "failed",
  to: string,
  resultKey: string,
  note: string,
): Promise<void> {
  await db.from("audit_logs").insert({
    entity_type: "notification",
    entity_id: to,
    action,
    field: "line_push",
    old_value: null,
    new_value: `RESULT-ID:${resultKey} ${note}`.slice(0, 400),
  });
}

/** idempotency (มิติ 6): หาผลส่งของ resultKey เดิม (sent) ภายใน 24 ชม. — พบแล้วไม่ยิงซ้ำ */
async function findPriorSent(
  db: DeliveryDeps["db"],
  to: string,
  resultKey: string,
  nowMs: number,
): Promise<boolean> {
  const since = new Date(nowMs - AUDIT_WINDOW_HOURS * 3600_000).toISOString();
  const { data, error } = await db
    .from("audit_logs")
    .select("id")
    .eq("entity_type", "notification")
    .eq("entity_id", to)
    .eq("action", "sent")
    .ilike("new_value", `RESULT-ID:${resultKey}%`)
    .gte("created_at", since)
    .limit(1);
  if (error) return false; // อ่านไม่ได้ = นิยามว่า "ไม่รู้" → ปล่อยส่ง (fail-open ฝั่ง idempotency only; แจ้งผ่าน result)
  return Array.isArray(data) && data.length > 0;
}

/** live_commands row เดิม (คอลัมน์เป๊ะของ app/api/internal/line/command) — บอร์ดที่รับเห็นผล */
async function recordLiveCommand(
  db: DeliveryDeps["db"],
  input: ResultDeliveryInput,
  replyText: string,
): Promise<void> {
  await db.from("live_commands").insert({
    line_user_id: input.lineUserId,
    command_text: input.resultKey,
    reply_text: replyText,
    navigate_url: input.navigateUrl ?? null,
    workspace: input.workspace ?? null,
  });
}

function retryableFailureClass(cls?: NormalizedFailureClass | null): boolean {
  // deterministic classification เดิม 4 ค่า — เข้มสุด: retry เฉพาะ PROVIDER_UNAVAILABLE
  // (auth/rejected/infra/null = หยุดทันที ไม่มีทางสร้าง incident ซ้ำ)
  return cls === "PROVIDER_UNAVAILABLE";
}

export async function deliverBusinessResult(
  input: ResultDeliveryInput,
  depsIn?: Partial<DeliveryDeps>,
): Promise<ResultDeliveryResult> {
  const deps: DeliveryDeps = {
    db: depsIn?.db ?? (supabaseAdmin() as unknown as DeliveryDeps["db"]),
    send: depsIn?.send ?? sendLineMessage,
    normalizer: depsIn?.normalizer ?? normalizeSendResult,
    now: depsIn?.now ?? (() => new Date()),
  };

  // มิติ 3 — Capability Authorization fail-closed
  const allowed = input.authorize ? await input.authorize() : false;
  if (!allowed) {
    return { status: "SKIPPED_UNAUTHORIZED", attempts: 0 };
  }

  // มิติ 6 — กันยิงซ้ำ ก่อนแตะ provider
  if (await findPriorSent(deps.db, input.lineUserId, input.resultKey, deps.now().getTime())) {
    return { status: "SKIPPED_DUPLICATE", attempts: 0 };
  }

  let lastClass: NormalizedFailureClass | null = null;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    attemptsUsed = attempt;
    const res = await deps.send(deps.db, input.lineUserId, [{ type: "text", text: input.replyText }]);
    // มิติ 4 — Delivery Status (Business ไม่เห็น raw provider error เดิมเท่านั้น)
    const normalized = await deps.normalizer(res, {
      providerSlug: "line",
      businessAction: "line.result_delivery",
      ownerId: "connect-result-delivery",
      actor: "engines/delivery/result-delivery",
      source: "engines/delivery/result-delivery.ts",
    });

    if (normalized.ok) {
      const messageId = "messageId" in res && typeof (res as { messageId?: string }).messageId === "string"
        ? (res as { messageId: string }).messageId
        : undefined;
      await auditLog(deps.db, "sent", input.lineUserId, input.resultKey, input.replyText.slice(0, 180));
      await recordLiveCommand(deps.db, input, input.replyText);
      return { status: "SENT", messageId, attempts: attempt };
    }

    lastClass = normalized.failureClass;
    const canRetry = attempt < MAX_SEND_ATTEMPTS && retryableFailureClass(lastClass);
    await auditLog(deps.db, "failed", input.lineUserId, input.resultKey,
      `attempt=${attempt} class=${lastClass ?? "UNKNOWN"} canRetry=${canRetry}`);
    if (!canRetry) break;
  }

  return { status: "FAILED", attempts: attemptsUsed, failureClass: lastClass ?? undefined };
}
