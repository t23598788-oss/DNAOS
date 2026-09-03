/**
 * หน้าที่: พิสูจน์ตัวตน Owner จาก signal จริง แล้วออก session — และ validate/revoke
 *
 * ── กฎ ──
 * - "macos-console-session": ผู้ใช้ GUI ที่ล็อกอินจริง (stat /dev/console) ต้องตรงกับ
 *   expected_owner จึงออก session — ถ้าไม่ตรง/อ่านไม่ได้ = DENY
 * - "touch-id": ยังไม่มี LocalAuthentication helper จริง → DENY (ไม่แกล้งสำเร็จ)
 * - สตริงชื่อเฉย ๆ ไม่มี signal = ไม่ผ่านทางนี้ (ไม่มี method ที่รับ string ล้วน)
 * - session มี TTL + revoke; validate fail closed ทุกทาง
 *
 * Dependency ที่อนุญาต: node:child_process (อ่าน console user), node:fs/path, ./types.ts.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AuthenticateOwnerInput, AuthenticateOwnerResult, OwnerSession,
  RevokeOwnerSessionResult, ValidateOwnerSessionResult,
} from "./types";

const DATA_DIR = "control/owner-authentication/data";
const FILE = "owner-sessions.jsonl";

/** อ่านผู้ใช้ที่ล็อกอิน GUI จริงบนเครื่อง (console user) — signal จริง ไม่ใช่ process user */
function readConsoleUserReal(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    return execFileSync("/usr/bin/stat", ["-f", "%Su", "/dev/console"], { timeout: 3000 }).toString().trim() || null;
  } catch {
    return null;
  }
}

function store(baseDir: string) {
  const file = join(baseDir, FILE);
  const ensure = () => { mkdirSync(baseDir, { recursive: true }); if (!existsSync(file)) writeFileSync(file, "", "utf-8"); };
  const latest = (): Map<string, OwnerSession> => {
    ensure();
    const m = new Map<string, OwnerSession>();
    for (const l of readFileSync(file, "utf-8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as OwnerSession; m.set(r.session_id, r); }
    return m;
  };
  return {
    find: (id: string) => latest().get(id) ?? null,
    upsert: (s: OwnerSession) => { ensure(); appendFileSync(file, `${JSON.stringify(s)}\n`, { encoding: "utf8", mode: 0o600 }); return s; },
  };
}

export interface OwnerAuthDeps {
  readConsoleUser: () => string | null;
  now: () => Date;
  newId: () => string;
  baseDir: string;
}
const defaultDeps: OwnerAuthDeps = {
  readConsoleUser: readConsoleUserReal,
  now: () => new Date(),
  newId: () => `owner-session-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
  baseDir: join(process.cwd(), DATA_DIR),
};

export function authenticateOwner(input: AuthenticateOwnerInput, deps: OwnerAuthDeps = defaultDeps): AuthenticateOwnerResult {
  if (!Number.isFinite(input.ttl_seconds) || input.ttl_seconds <= 0 || input.ttl_seconds > 43_200) {
    return { ok: false, reason_code: "INVALID_TTL", detail: "ttl ต้องอยู่ใน (0, 43200]" };
  }
  if (input.method === "touch-id") {
    // ไม่มี LocalAuthentication helper จริง — ปฏิเสธ ไม่แกล้งว่าผ่าน
    return { ok: false, reason_code: "TOUCH_ID_HELPER_NOT_AVAILABLE", detail: "ยังไม่ได้ build LocalAuthentication helper — ไม่แกล้งผล biometric" };
  }
  // macos-console-session: signal จริงต้องตรง expected_owner
  const consoleUser = deps.readConsoleUser();
  if (!consoleUser) return { ok: false, reason_code: "NO_CONSOLE_SESSION", detail: "อ่าน console user ไม่ได้ (ไม่มี GUI session)" };
  if (consoleUser !== input.expected_owner) {
    return { ok: false, reason_code: "OWNER_SIGNAL_MISMATCH", detail: `console user "${consoleUser}" != expected "${input.expected_owner}" — สตริงชื่อเฉย ๆ ไม่ผ่าน` };
  }
  const issued = deps.now();
  const session: OwnerSession = {
    session_id: deps.newId(),
    owner_identity: consoleUser,
    authenticated_via: "macos-console-session",
    device_binding: null,
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + input.ttl_seconds * 1000).toISOString(),
    state: "ACTIVE",
    revoked_at: null,
    evidence_reference: null,
  };
  store(deps.baseDir).upsert(session);
  return { ok: true, session };
}

export function validateOwnerSession(session_id: string, deps: OwnerAuthDeps = defaultDeps): ValidateOwnerSessionResult {
  const s = store(deps.baseDir).find(session_id);
  if (!s) return { ok: false, reason_code: "OWNER_SESSION_NOT_FOUND", detail: session_id };
  if (s.state === "REVOKED" || s.revoked_at !== null) return { ok: false, reason_code: "OWNER_SESSION_REVOKED", detail: s.revoked_at ?? "revoked" };
  if (deps.now().getTime() > new Date(s.expires_at).getTime()) return { ok: false, reason_code: "OWNER_SESSION_EXPIRED", detail: s.expires_at };
  return { ok: true, session: s };
}

export function revokeOwnerSession(session_id: string, deps: OwnerAuthDeps = defaultDeps): RevokeOwnerSessionResult {
  const s = store(deps.baseDir).find(session_id);
  if (!s) return { ok: false, reason_code: "OWNER_SESSION_NOT_FOUND" };
  const revoked: OwnerSession = { ...s, state: "REVOKED", revoked_at: deps.now().toISOString() };
  store(deps.baseDir).upsert(revoked);
  return { ok: true, session: revoked };
}

export { readConsoleUserReal };
