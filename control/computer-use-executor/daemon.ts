/**
 * หน้าที่: DNA OS Computer-Use Executor daemon entrypoint — process ที่ launchd รันได้จริง
 *
 * daemon นี้ทำหน้าที่จำกัดมาก: รับ Work Order (canonical local ingress = file inbox),
 * validate schema + Owner session + lease ตาม contract เดิม, dispatch ไป executeComputerUse(),
 * แล้ว persist evidence — **ไม่ตัดสิน permission เอง ไม่ grant เอง ไม่เก็บ secret ไม่เปลี่ยน requester**
 *
 * ── ทำไม file inbox ──
 * ตรวจแล้วไม่มี queue/ingress เดิมที่ dispatch computer-use ops ได้ (owner-command HTTP ผ่าน
 * command-router ซึ่ง allowlist ไม่รวม browser_eval) จึงใช้ local file-queue ขั้นต่ำ:
 *   data/inbox/<id>.json    ← Work Order (ผู้เขียนคือ DNA OS/Owner flow ไม่ใช่ daemon)
 *   data/processed/<id>.json ← ย้ายหลังทำเสร็จ
 *   data/results/<id>.json   ← ผลลัพธ์ + evidence_id
 * local-only, fail-closed, ไม่มี network listener
 *
 * ── สิ่งที่ daemon ห้าม ──
 * ตัดสิน permission เอง / เก็บ secret / grant ตัวเอง / เปลี่ยน requester เป็นตัวเอง /
 * execute request ที่ malformed/unverified / trigger browser_eval ที่ Claude classifier บล็อก
 * (daemon รัน operation ที่มาใน Work Order ที่ valid เท่านั้น — ผู้ originate Work Order รับผิดชอบ)
 *
 * รัน: npx tsx control/computer-use-executor/daemon.ts          (loop, สำหรับ launchd)
 *      npx tsx control/computer-use-executor/daemon.ts --once   (drain inbox หนึ่งรอบ)
 * Dependency ที่อนุญาต: ./executor.ts, ../owner-authentication/contract.ts, node:fs/path.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeComputerUse, EXECUTOR_IDENTITY } from "./executor";
import { classifyOutcome } from "./outcome-classification";
import { appendClassification, readDiagnosticFindings, readDiagnosticProcedures } from "./outcome-classification-store";
import type { ComputerUseRequest } from "./executor";
import { validateOwnerSession } from "../owner-authentication/contract";
import { resolveComputerUseAuthorization } from "../computer-use-policy/contract";
import type { ComputerUseOperation } from "../computer-use-authority/types";

const BASE = "control/computer-use-executor/data";
const INBOX = "inbox", PROCESSED = "processed", RESULTS = "results";

/**
 * Work Order ของ daemon = ComputerUseRequest + owner_session_id + ฟิลด์สำหรับ Policy V2
 * `authority_id` เป็น optional: ถ้ามี = task-scoped auth ที่ Owner grant ไว้; ถ้าไม่มี =
 * ให้ Policy V2 (resolve) ตัดสิน (ON auto-grant / OFF → OWNER_APPROVAL_REQUIRED)
 */
export interface ComputerUseWorkOrder extends Omit<ComputerUseRequest, "authority_id"> {
  owner_session_id: string;
  authority_id?: string;
  ttl_seconds?: number;
  is_external_commit?: boolean;
}

export interface DaemonResult {
  work_order_id: string;
  accepted: boolean;
  reason: string;
  execution_owner: string;
  executed: boolean;
  result_status: string | null;
  evidence_id: string | null;
}

const VALID_OPERATIONS = new Set<ComputerUseOperation>([
  "screenshot", "read_screen", "click", "type", "key", "scroll", "drag", "focus", "pointer_move", "double_click",
  "clipboard", "file_chooser", "file_upload", "browser_navigate", "browser_eval",
  "login", "credential_reference", "provider_authorization",
]);

/** schema validation — fail closed บน malformed */
function validateSchema(o: unknown): { ok: true; wo: ComputerUseWorkOrder } | { ok: false; reason: string } {
  if (!o || typeof o !== "object") return { ok: false, reason: "MALFORMED: not an object" };
  const w = o as Record<string, unknown>;
  for (const f of ["work_order_id", "owner_session_id", "requester", "operation", "target"]) {
    if (typeof w[f] !== "string" || (w[f] as string).length === 0) return { ok: false, reason: `MALFORMED: missing/empty "${f}"` };
  }
  if (w.authority_id !== undefined && typeof w.authority_id !== "string") return { ok: false, reason: "MALFORMED: authority_id must be string" };
  if (!VALID_OPERATIONS.has(w.operation as ComputerUseOperation)) return { ok: false, reason: `MALFORMED: unknown operation "${String(w.operation)}"` };
  if (w.ui !== undefined && (typeof w.ui !== "object" || w.ui === null)) return { ok: false, reason: "MALFORMED: ui must be object" };
  return { ok: true, wo: { ...(w as unknown as ComputerUseWorkOrder), ui: (w.ui as ComputerUseWorkOrder["ui"]) ?? {} } };
}

/**
 * process หนึ่ง Work Order ครบเส้น: schema → owner session → executeComputerUse (lease) → evidence
 * ทุก DENY ก่อนถึง executor จะไม่ execute อะไรเลย (fail closed)
 */
export async function processWorkOrder(raw: unknown, deps: { validateOwnerSession: typeof validateOwnerSession } = { validateOwnerSession }): Promise<DaemonResult> {
  const base = { execution_owner: EXECUTOR_IDENTITY, executed: false, result_status: null as string | null, evidence_id: null as string | null };
  const schema = validateSchema(raw);
  if (!schema.ok) return { work_order_id: (raw as { work_order_id?: string })?.work_order_id ?? "unknown", accepted: false, reason: schema.reason, ...base };
  const wo = schema.wo;

  // Owner session ต้อง valid (fail closed) — daemon ไม่ยอมรับ request ที่ไม่มี Owner ที่ auth แล้ว
  const sess = deps.validateOwnerSession(wo.owner_session_id);
  if (!sess.ok) return { work_order_id: wo.work_order_id, accepted: false, reason: `OWNER_SESSION_${sess.reason_code}`, ...base };

  // Policy V2 (canonical path): Work Order → resolve (ON auto-grant / OFF OWNER_APPROVAL_REQUIRED /
  // high-risk/login → SEPARATE_AUTH_REQUIRED / task auth → validate). daemon ไม่ตัดสินเอง — เรียก resolve
  const scope = wo.scope_needed ?? [];
  const resolved = resolveComputerUseAuthorization({
    work_order_id: wo.work_order_id, requester: wo.requester, operation: wo.operation, target: wo.target,
    scope, ttl_seconds: wo.ttl_seconds ?? 60, is_external_commit: wo.is_external_commit, task_authority_id: wo.authority_id,
  });
  if (!resolved.ok) return { work_order_id: wo.work_order_id, accepted: false, reason: `${resolved.mode}:${resolved.reason_code}`, ...base };

  // dispatch → executeComputerUse (validate lease + os-ui admission ข้างใน, fail closed ซ้อน)
  // The executor has accepted an observation target, a routing-context flag, a
  // declared capability and a declared intent since Steps 9-15, but this
  // dispatch never passed them on. The effect of that omission was not a
  // rejection — it was silence: every execution arriving through the canonical
  // Work Order path observed nothing, so its verdict could only ever be
  // UNPROVEN, and the deterministic verification built in Steps 3-6 was
  // unreachable from production. Forwarding what the Work Order already carries
  // is the whole fix. Each field stays optional, so a Work Order that omits it
  // behaves exactly as before: absent is recorded as "not requested", never as
  // a failed observation.
  const { evidence } = await executeComputerUse({
    work_order_id: wo.work_order_id, authority_id: resolved.authority_id, requester: wo.requester,
    operation: wo.operation, target: wo.target, scope_needed: scope, ui: wo.ui,
    capability_id: wo.capability_id,
    observation_target: wo.observation_target,
    capture_routing_context: wo.capture_routing_context,
    intent_declaration: wo.intent_declaration,
    settle_ms: wo.settle_ms,
  });
  // CLASSIFY — on the live path, not by hand. The classifier existed since
  // 2026-09-02 but had no production caller, so only 4 of 799 execution rows
  // had ever been classified and every operational question required someone to
  // invoke it. Classification never changes the execution result: it reads the
  // evidence just written and records what is known, unknown, and allowed next.
  try {
    const classification = classifyOutcome(evidence, readDiagnosticProcedures(), () => new Date(), readDiagnosticFindings());
    appendClassification(classification);
  } catch {
    // A classifier failure must never fail an execution that already happened.
    // The evidence row is the durable fact; the classification is a consequence.
  }

  return {
    work_order_id: wo.work_order_id, accepted: evidence.authorized, reason: evidence.authorization_reason,
    execution_owner: evidence.execution_owner, executed: evidence.executed,
    result_status: evidence.result_status, evidence_id: evidence.evidence_id,
  };
}

function dir(name: string): string { const d = join(process.cwd(), BASE, name); mkdirSync(d, { recursive: true }); return d; }

/** drain inbox หนึ่งรอบ — คืนจำนวนที่ process */
export async function drainInbox(): Promise<DaemonResult[]> {
  const inbox = dir(INBOX), processed = dir(PROCESSED), results = dir(RESULTS);
  const out: DaemonResult[] = [];
  for (const f of readdirSync(inbox).filter((n) => n.endsWith(".json")).sort()) {
    const path = join(inbox, f);
    let raw: unknown = null;
    try { raw = JSON.parse(readFileSync(path, "utf-8")); } catch { raw = { work_order_id: f, __malformed: true }; }
    const result = await processWorkOrder(raw);
    writeFileSync(join(results, `${result.work_order_id}.json`), JSON.stringify(result, null, 1), { encoding: "utf8", mode: 0o600 });
    renameSync(path, join(processed, f));
    out.push(result);
  }
  return out;
}

async function loop(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await drainInbox(); } catch (e) { console.error("daemon drain error:", e instanceof Error ? e.message : String(e)); }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// entrypoint
if (process.argv[1] && process.argv[1].endsWith("daemon.ts")) {
  const once = process.argv.includes("--once");
  console.log(`computer-use-executor daemon starting (pid=${process.pid}, mode=${once ? "once" : "loop"}, execution_owner=${EXECUTOR_IDENTITY})`);
  if (once) { void drainInbox().then((r) => { console.log(JSON.stringify(r, null, 1)); process.exit(0); }); }
  else void loop();
}
