/**
 * หน้าที่: สวิตช์ canonical ของ Computer Use — COMPUTER_USE_PREAUTHORIZED = ON | OFF
 *
 * ── ความหมาย (ล็อกตาม V2) ──
 * ON  = Owner อนุญาต computer use "ปกติ" (LEVEL 0-2, ไม่ high-risk/ไม่ login/ไม่ external commit)
 *       ไว้ล่วงหน้า → ไม่ต้องขอ approval ซ้ำทุกงาน แต่ยังต้องผ่าน Work Order + Policy +
 *       Authority + Executor + Evidence (ON ≠ unrestricted)
 * OFF = ไม่มี pre-authorization แต่ capability ยัง AVAILABLE/CALLABLE — งานที่ต้องใช้ต้องขอ
 *       task-scoped authorization จาก Owner (OFF ≠ DISABLED/EXECUTOR_STOPPED)
 *
 * สวิตช์นี้เป็น "authorization behavior" ไม่ใช่ lifecycle ของ executor
 * เปลี่ยนได้เฉพาะโดย Owner ที่พิสูจน์ตัวตนแล้ว (owner-authentication)
 *
 * Dependency ที่อนุญาต: node:fs/path, ../owner-authentication/contract.ts, ./types (inline).
 * สิ่งที่ห้ามแตะ: ห้ามให้สวิตช์นี้ disable capability; ห้ามให้ ON ครอบ high-risk/login/external commit.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateOwnerSession } from "../owner-authentication/contract";
import type { OwnerAuthDeps } from "../owner-authentication/contract";

const DATA_DIR = "control/computer-use-policy/data";
const FILE = "preauthorization.jsonl";

export interface PreauthorizationRecord {
  preauthorized: boolean;
  /** ระดับสูงสุดที่ pre-auth ครอบ — canonical = 2 (UI control) ห้ามเกิน */
  preauth_max_level: 0 | 1 | 2;
  set_by_owner_session: string;
  owner_identity: string;
  updated_at: string;
}

/** ค่าเริ่มต้นเมื่อยังไม่เคยตั้ง = OFF (fail-safe: ไม่ pre-authorize อะไรจนกว่า Owner จะเปิด) */
const DEFAULT: PreauthorizationRecord = { preauthorized: false, preauth_max_level: 2, set_by_owner_session: "", owner_identity: "", updated_at: "1970-01-01T00:00:00.000Z" };

function baseDir(): string { const d = join(process.cwd(), DATA_DIR); mkdirSync(d, { recursive: true }); return d; }
function file(): string { const f = join(baseDir(), FILE); if (!existsSync(f)) writeFileSync(f, "", "utf-8"); return f; }

export function readPreauthorization(): PreauthorizationRecord {
  const f = file();
  let latest = DEFAULT;
  for (const l of readFileSync(f, "utf-8").split("\n")) if (l.trim()) latest = JSON.parse(l) as PreauthorizationRecord;
  return latest;
}

export type SetPreauthorizationResult =
  | { ok: true; record: PreauthorizationRecord }
  | { ok: false; reason_code: string; detail: string };

/** เปลี่ยนสวิตช์ — ต้องเป็น Owner ที่ authenticate แล้วเท่านั้น (ไม่ใช่สตริง) */
export function setPreauthorization(session_id: string, on: boolean, authDeps?: OwnerAuthDeps, now: () => Date = () => new Date()): SetPreauthorizationResult {
  const s = authDeps ? validateOwnerSession(session_id, authDeps) : validateOwnerSession(session_id);
  if (!s.ok) return { ok: false, reason_code: `OWNER_${s.reason_code}`, detail: s.detail };
  const record: PreauthorizationRecord = { preauthorized: on, preauth_max_level: 2, set_by_owner_session: s.session.session_id, owner_identity: s.session.owner_identity, updated_at: now().toISOString() };
  appendFileSync(file(), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  return { ok: true, record };
}
