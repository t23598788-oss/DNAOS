/**
 * หน้าที่: ขอบเขต Core API ของ Computer Use — **adapter บาง ๆ เท่านั้น**
 *
 * ไฟล์นี้ไม่มี logic ของ authority/login/authentication ของตัวเองแม้แต่บรรทัดเดียว
 * ทุก endpoint แปลง HTTP -> เรียก capability ที่มีอยู่แล้ว -> คืนผลที่มีโครงสร้าง
 *
 *   readComputerUseStatus()   control/computer-use-authority/status-contract.ts
 *   authenticateOwner()       control/owner-authentication/
 *   validateOwnerSession()    control/owner-authentication/
 *   revokeOwnerSession()      control/owner-authentication/
 *   grantAuthorityAsOwner()   control/owner-authentication/   (บังคับ owner session เอง)
 *   revokeAuthority()         control/computer-use-authority/
 *   requestLogin()            control/computer-use-executor/login-authority.ts
 *
 * เส้นทางที่บังคับ:
 *   Settings Consumer -> Core API -> Owner Authentication
 *                     -> Computer-Use Authority -> Computer-Use Executor
 *
 * สิ่งที่ห้ามแตะ:
 *   - ห้าม re-implement การตรวจสิทธิ์ ถ้า capability เดิมตรวจอยู่แล้ว ให้เรียกมัน
 *   - ห้ามคืนค่า secret ดิบ ไม่ว่ากรณีใด (`requestLogin` ปฏิเสธ want_raw_secret อยู่แล้ว
 *     และ `stripSecrets` เป็นด่านที่สองที่ขาออก)
 *   - ห้ามให้ Claude/Codex/Agent เป็น executor — `grantAuthority` บังคับ
 *     `isDnaOsExecutor` อยู่แล้ว ที่นี่จึงไม่ตัดสินซ้ำ แค่ส่งผ่านและปฏิเสธตามที่มันบอก
 *   - fail closed: อะไรที่ตรวจไม่ผ่านหรือ parse ไม่ได้ = DENIED ไม่ใช่ผ่าน
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { coreNodeUnavailableForCapability, coreNodeUnavailableForOwnerAuthMethod } from "./mac-local-agent-gate";
import { readComputerUseStatus } from "../../control/computer-use-authority/status-contract";
import { revokeAuthority, listLeases } from "../../control/computer-use-authority/contract";
import { authenticateOwner, validateOwnerSession, revokeOwnerSession, grantAuthorityAsOwner } from "../../control/owner-authentication/contract";
import { requestLogin } from "../../control/computer-use-executor/login-authority";
import { readPreauthorization, setPreauthorization } from "../../control/computer-use-policy/contract";

const EVIDENCE_DIR = join(__dirname, "data");
const EVIDENCE_FILE = join(EVIDENCE_DIR, "computer-use-api-evidence.jsonl");

export interface ApiReply { readonly status: number; readonly body: unknown }

/** ด่านที่สองขาออก — ต่อให้ capability ใดหลุด ก็ไม่มี secret ผ่านออกไปจากที่นี่ */
const SECRET_KEY = /(password|passphrase|secret|token|api[_-]?key|private[_-]?key|cookie)/i;
export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // credential_ref / credential_reference เป็น "ตัวชี้" ไม่ใช่ secret จึงผ่านได้
      if (SECRET_KEY.test(k) && !/^credential_(ref|reference|status)$/.test(k)) { out[k] = "[REDACTED]"; continue; }
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}

function recordEvidence(entry: Record<string, unknown>): string {
  const evidence_id = `cu-api-${randomUUID()}`;
  try {
    if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
    appendFileSync(EVIDENCE_FILE, `${JSON.stringify({ evidence_id, recorded_at: new Date().toISOString(), ...entry })}\n`,
      { encoding: "utf8", mode: 0o600 });
  } catch { /* เขียนหลักฐานไม่ได้ ต้องไม่ทำให้ผลลัพธ์กลายเป็นสำเร็จ — ผู้เรียกยังได้ evidence_id ที่ตามไม่เจอ */ }
  return evidence_id;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const deny = (reason_code: string, detail: string, extra: Record<string, unknown> = {}): ApiReply => {
  const evidence_id = recordEvidence({ outcome: "DENIED", reason_code, detail, ...extra });
  return { status: 200, body: { ok: false, reason_code, detail, evidence_id } };
};

/** owner session ต้องใช้ได้จริง มิฉะนั้น DENY — ใช้ capability เดิมตรวจ ไม่ตรวจเอง */
function requireOwnerSession(session_id: string | null): { ok: true; session_id: string } | ApiReply {
  if (!session_id) return deny("OWNER_SESSION_REQUIRED", "ต้องมี owner_session_id");
  const v = validateOwnerSession(session_id);
  if (!v.ok) return deny(v.reason_code, "detail" in v ? String(v.detail ?? "") : "", { session_id });
  return { ok: true, session_id };
}
const isReply = (v: unknown): v is ApiReply => typeof v === "object" && v !== null && "status" in v;

/**
 * คืน null เมื่อ path ไม่ใช่ของ Computer Use — ให้ router เดิมเดินต่อ
 */
import { createChallenge, runVerification } from "../../control/owner-authentication/human-verification";
import { setControlMode } from "../../control/computer-use-authority/work-lease";

/** session ที่ผ่านการยืนยันตัวตนจริงและยังไม่หมดอายุ — ตัวชี้ภายใน ไม่ส่งออกนอก */
function activeVerifiedSessionId(): string | null {
  const fs = require("node:fs") as typeof import("node:fs");
  const pathMod = require("node:path") as typeof import("node:path");
  const file = pathMod.join(process.cwd(), "control/owner-authentication/data/owner-sessions.jsonl");
  const latest = new Map<string, { session_id: string; state: string; expires_at: string; authenticated_via?: string }>();
  try {
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      if (line.trim() === "") continue;
      try { const r = JSON.parse(line); if (r.session_id) latest.set(r.session_id, r); } catch { /* ข้ามแถวเสีย */ }
    }
  } catch { return null; }
  const now = Date.now();
  const live = [...latest.values()].filter((x) => x.state === "ACTIVE" && new Date(x.expires_at).getTime() > now
    && String(x.authenticated_via ?? "").startsWith("human-verification"));
  return live.length > 0 ? live[live.length - 1]!.session_id : null;
}

export function handleComputerUseApi(method: string, path: string, body: unknown): ApiReply | null {
  const b = (body ?? {}) as Record<string, unknown>;

  if (method === "GET" && path === "/computer-use/status") {
    // preauthorization เป็นของ control/computer-use-policy — อ่านมาแสดงเฉย ๆ
    // ไม่ตัดสินอะไร และไม่ใช่ตัวชี้ว่า capability ใช้ได้หรือไม่
    return { status: 200, body: stripSecrets({
      ok: true, ...readComputerUseStatus(),
      preauthorization: readPreauthorization(),
      claude_role: "REQUESTER_ONLY", read_only: true,
    }) };
  }

  /**
   * ตั้งค่า COMPUTER_USE_PREAUTHORIZED (Policy V2)
   *
   * OFF **ไม่ใช่** lock และ **ไม่ใช่** revoke — Computer Use ยังเรียกได้อยู่
   * แต่งานที่เข้าเงื่อนไขจะต้องขออนุญาต Owner เป็นรายงาน
   * owner session เป็น *เงื่อนไขก่อนเปลี่ยนค่า* ไม่ใช่ค่าของสวิตช์
   * และ `setPreauthorization` ตรวจ session เองอยู่แล้ว ที่นี่จึงไม่ตรวจซ้ำ
   */
  if (method === "POST" && path === "/computer-use/policy/preauthorization") {
    const session_id = str(b.owner_session_id);
    if (!session_id) return deny("OWNER_SESSION_REQUIRED", "ต้องมี owner_session_id");
    if (typeof b.on !== "boolean") return deny("INVALID_REQUEST", "ต้องมี on เป็น boolean");
    const result = setPreauthorization(session_id, b.on);
    const evidence_id = recordEvidence({ endpoint: "policy/preauthorization",
      outcome: result.ok ? (b.on ? "PREAUTHORIZED_ON" : "PREAUTHORIZED_OFF") : "DENIED",
      session_id, requested_on: b.on, reason_code: result.ok ? null : result.reason_code });
    return { status: 200, body: stripSecrets({ ...result, preauthorization: readPreauthorization(), evidence_id }) };
  }

  if (method === "POST" && path === "/computer-use/owner/authenticate") {
    const expected_owner = str(b.expected_owner);
    const methodName = str(b.method);
    const ttl = Number(b.ttl_seconds);
    if (!expected_owner || !methodName) return deny("INVALID_REQUEST", "ต้องมี method และ expected_owner");
    if (!Number.isFinite(ttl)) return deny("INVALID_REQUEST", "ttl_seconds ต้องเป็นตัวเลข");
    const denied = coreNodeUnavailableForOwnerAuthMethod(methodName);
    if (denied) return { status: 503, body: denied };
    const result = authenticateOwner({ method: methodName as never, expected_owner, ttl_seconds: ttl });
    const evidence_id = recordEvidence({ endpoint: "owner/authenticate", outcome: result.ok ? "AUTHENTICATED" : "DENIED",
      expected_owner, method: methodName, reason_code: result.ok ? null : result.reason_code });
    return { status: 200, body: stripSecrets({ ...result, evidence_id }) };
  }

  /**
   * OWNER SURFACE — ยืนยันเจ้าของจบในการกดครั้งเดียว
   *
   * Owner, 2026-09-05: เจ้าของต้องไม่เปิด Terminal และต้องไม่ copy session_id
   * เส้นนี้รวมสามขั้นที่พิสูจน์แล้วไว้ในคำขอเดียว: สร้าง challenge -> เรียก
   * native LocalAuthentication helper (macOS เด้งหน้าต่างเอง) -> ใช้ challenge
   * ที่ยืนยันแล้วออก session ผ่าน authenticateOwner ตัวเดิม
   *
   * ไม่มี session model ใหม่และไม่มีสำเนา helper — เรียกของเดิมทั้งสามขั้น
   * และ session_id ไม่ถูกส่งกลับไปให้หน้าจอ
   */
  if (method === "POST" && path === "/computer-use/owner/verify") {
    const denied = coreNodeUnavailableForCapability("control/owner-authentication");
    if (denied) return { status: 503, body: denied };
    const expected = str(b.expected_owner) ?? "tam";
    const purpose = str(b.purpose) ?? "ยืนยันตัวตนเพื่ออนุญาตให้ DNA OS ควบคุมคอมพิวเตอร์ตามสิทธิ์ที่กำหนด";
    const ceiling = (str(b.authority_class) ?? "CLASS_1_NAVIGATION") as never;
    const created = createChallenge({ expected_owner: expected, purpose, requested_authority_class: ceiling });
    if (!created.ok) {
      const evidence_id = recordEvidence({ endpoint: "owner/verify", outcome: "DENIED", expected_owner: expected, reason_code: created.reason_code });
      return { status: 200, body: { ok: false, reason_code: created.reason_code, detail: created.detail, evidence_id } };
    }
    const verified = runVerification(created.challenge.challenge_id);
    if (verified.outcome !== "VERIFIED") {
      const evidence_id = recordEvidence({ endpoint: "owner/verify", outcome: "DENIED", expected_owner: expected, reason_code: verified.outcome });
      return { status: 200, body: { ok: false, reason_code: verified.outcome, detail: verified.error_code ?? null, evidence_id } };
    }
    const ttl = Number.isFinite(Number(b.ttl_seconds)) ? Number(b.ttl_seconds) : 3600;
    const minted = authenticateOwner({ method: "human-verification", expected_owner: expected, ttl_seconds: ttl,
      verified_challenge_id: created.challenge.challenge_id } as never) as { ok: boolean; reason_code?: string; detail?: string; session?: { expires_at: string } };
    const evidence_id = recordEvidence({ endpoint: "owner/verify", outcome: minted.ok ? "AUTHENTICATED" : "DENIED",
      expected_owner: expected, method: "human-verification", reason_code: minted.ok ? null : minted.reason_code });
    // ไม่คืน session_id ให้หน้าจอโดยเจตนา — หน้าจอไม่ต้องถือและไม่ต้อง copy
    return { status: 200, body: minted.ok
      ? { ok: true, verified: true, verification_method: verified.verification_method_class,
          expires_at: minted.session?.expires_at ?? null, authority_ceiling: String(ceiling), evidence_id }
      : { ok: false, reason_code: minted.reason_code, detail: minted.detail, evidence_id } };
  }

  /**
   * เพิกถอนจากหน้าจอ — เจ้าของไม่ต้องถือ session_id
   *
   * เส้นเดิม /computer-use/lock ต้องการ owner_session_id ซึ่งหน้าจอไม่มีโดยเจตนา
   * (เราไม่เคยส่ง session_id ออกไปให้ UI) Core จึงต้องหา session ที่ยังใช้ได้เอง
   * แล้วเพิกถอน — ใช้ revokeOwnerSession ตัวเดิม ไม่มี session model ใหม่
   */
  if (method === "POST" && path === "/computer-use/owner/revoke") {
    const fs = require("node:fs") as typeof import("node:fs");
    const pathMod = require("node:path") as typeof import("node:path");
    const file = pathMod.join(process.cwd(), "control/owner-authentication/data/owner-sessions.jsonl");
    const latest = new Map<string, { session_id: string; state: string; expires_at: string; authenticated_via?: string }>();
    try {
      for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
        if (line.trim() === "") continue;
        try { const r = JSON.parse(line); if (r.session_id) latest.set(r.session_id, r); } catch { /* ข้ามแถวเสีย */ }
      }
    } catch { /* ไม่มีไฟล์ = ไม่มี session */ }
    const now = Date.now();
    const live = [...latest.values()].filter((x) => x.state === "ACTIVE" && new Date(x.expires_at).getTime() > now);
    let revoked = 0;
    for (const s0 of live) { if ((revokeOwnerSession(s0.session_id) as { ok: boolean }).ok) revoked += 1; }
    const evidence_id = recordEvidence({ endpoint: "owner/revoke", outcome: "REVOKED", revoked_count: revoked });
    return { status: 200, body: { ok: true, revoked_sessions: revoked, evidence_id } };
  }

  /**
   * ตั้งโหมดควบคุมคอมพิวเตอร์จากหน้าจอ — เจ้าของไม่ต้องถือ session_id
   *
   * เหตุผลเดียวกับ /computer-use/owner/revoke: หน้าจอไม่เคยได้ session_id
   * Core จึงหา session ที่ยังใช้ได้เอง แล้วส่งให้ setControlMode ตัวเดิม
   * ไม่มี state ใหม่และไม่มีการลดด่าน — setControlMode ยังตรวจ session เหมือนเดิม
   */
  if (method === "POST" && path === "/computer-use/owner/mode") {
    const wanted = str(b.mode);
    if (wanted !== "OFF" && wanted !== "PER_TASK" && wanted !== "CONTINUOUS") {
      return deny("INVALID_REQUEST", "mode ต้องเป็น OFF | PER_TASK | CONTINUOUS");
    }
    const sid = activeVerifiedSessionId();
    if (sid === null) {
      const evidence_id = recordEvidence({ endpoint: "owner/mode", outcome: "DENIED", reason_code: "HUMAN_VERIFICATION_REQUIRED", mode: wanted });
      return { status: 200, body: { ok: false, reason_code: "HUMAN_VERIFICATION_REQUIRED", detail: "ไม่มี session ที่เจ้าของยืนยันตัวตนไว้", evidence_id } };
    }
    const r = setControlMode(wanted, sid) as { ok: boolean; mode?: string; reason_code?: string; detail?: string };
    const evidence_id = recordEvidence({ endpoint: "owner/mode", outcome: r.ok ? "MODE_SET" : "DENIED", mode: wanted, reason_code: r.ok ? null : r.reason_code });
    return { status: 200, body: r.ok ? { ok: true, mode: r.mode, evidence_id } : { ok: false, reason_code: r.reason_code, detail: r.detail, evidence_id } };
  }

  if (method === "POST" && path === "/computer-use/authority/grant") {
    const gate = requireOwnerSession(str(b.owner_session_id));
    if (isReply(gate)) return gate;
    const required = ["requester", "executor", "capability", "target"] as const;
    for (const k of required) if (!str(b[k])) return deny("INVALID_REQUEST", `ต้องมี ${k}`);
    if (!Array.isArray(b.operations) || b.operations.length === 0) return deny("INVALID_REQUEST", "operations ต้องไม่ว่าง");
    const ttl = Number(b.ttl_seconds);
    if (!Number.isFinite(ttl) || ttl <= 0) return deny("INVALID_REQUEST", "ttl_seconds ต้อง > 0");
    // executor ต้องเป็น DNA OS component — grantAuthority บังคับด้วย isDnaOsExecutor
    // ที่นี่ไม่ตัดสินซ้ำ ส่งผ่านแล้วรายงานตามที่ capability ตอบ
    const result = grantAuthorityAsOwner(gate.session_id, {
      requester: String(b.requester), executor: String(b.executor), capability: String(b.capability),
      operations: b.operations as never, target: String(b.target),
      scope: Array.isArray(b.scope) ? (b.scope as string[]) : [],
      ttl_seconds: ttl,
      evidence_reference: str(b.evidence_reference),
      high_risk_explicit: b.high_risk_explicit === true,
      external_commit_explicit: b.external_commit_explicit === true,
    } as never);
    const evidence_id = recordEvidence({ endpoint: "authority/grant", outcome: result.ok ? "GRANTED" : "DENIED",
      session_id: gate.session_id, requester: b.requester, executor: b.executor, target: b.target,
      operations: b.operations, reason_code: result.ok ? null : (result as { reason_code?: string }).reason_code });
    return { status: 200, body: stripSecrets({ ...result, evidence_id }) };
  }

  if (method === "POST" && path === "/computer-use/authority/revoke") {
    const gate = requireOwnerSession(str(b.owner_session_id));
    if (isReply(gate)) return gate;
    const authority_id = str(b.authority_id);
    if (!authority_id) return deny("INVALID_REQUEST", "ต้องมี authority_id");
    const result = revokeAuthority(authority_id);
    const evidence_id = recordEvidence({ endpoint: "authority/revoke", outcome: result.ok ? "REVOKED" : "DENIED",
      authority_id, session_id: gate.session_id, reason_code: result.ok ? null : result.reason_code });
    return { status: 200, body: stripSecrets({ ...result, evidence_id }) };
  }

  if (method === "POST" && (path === "/computer-use/authority/revoke-all" || path === "/computer-use/lock")) {
    const gate = requireOwnerSession(str(b.owner_session_id));
    if (isReply(gate)) return gate;
    const active = readComputerUseStatus().active_leases ?? [];
    const revoked: string[] = [], failed: { authority_id: string; reason_code: string }[] = [];
    for (const lease of active) {
      const r = revokeAuthority(lease.authority_id);
      if (r.ok) revoked.push(lease.authority_id);
      else failed.push({ authority_id: lease.authority_id, reason_code: r.reason_code });
    }
    // LOCK = ถอนอำนาจที่ยังใช้ได้ทั้งหมด + ปิด owner session
    // ผลคือไม่มีใครสั่ง execute ได้จนกว่า Owner จะ authenticate ใหม่
    let sessionRevoked = false;
    if (path === "/computer-use/lock") sessionRevoked = revokeOwnerSession(gate.session_id).ok === true;
    const after = readComputerUseStatus();
    const evidence_id = recordEvidence({ endpoint: path, outcome: failed.length === 0 ? "REVOKED_ALL" : "PARTIAL",
      revoked, failed, owner_session_revoked: sessionRevoked, active_after: after.active_leases?.length ?? 0 });
    return { status: 200, body: stripSecrets({
      ok: failed.length === 0, revoked_count: revoked.length, revoked, failed,
      owner_session_revoked: sessionRevoked,
      locked: path === "/computer-use/lock" && (after.active_leases?.length ?? 0) === 0 && sessionRevoked,
      active_after: after.active_leases?.length ?? 0, evidence_id }) };
  }

  if (method === "POST" && path === "/computer-use/provider/login") {
    const required = ["authority_id", "requester", "provider", "credential_ref"] as const;
    for (const k of required) if (!str(b[k])) return deny("INVALID_REQUEST", `ต้องมี ${k}`);
    // ขอ secret ดิบ = ปฏิเสธ — requestLogin ปฏิเสธเองอยู่แล้ว ส่งผ่านไปให้มันตัดสิน
    const result = requestLogin({
      authority_id: String(b.authority_id), requester: String(b.requester),
      provider: String(b.provider), credential_ref: String(b.credential_ref),
      want_raw_secret: b.want_raw_secret === true,
    });
    const evidence_id = recordEvidence({ endpoint: "provider/login", outcome: result.ok ? "LOGIN_AUTHORIZED" : "DENIED",
      authority_id: b.authority_id, requester: b.requester, provider: b.provider,
      want_raw_secret: b.want_raw_secret === true, reason_code: result.ok ? null : result.reason_code });
    return { status: 200, body: stripSecrets({ ...result, evidence_id }) };
  }

  return null;
}

export { listLeases };
