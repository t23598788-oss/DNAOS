/**
 * หน้าที่: สะพานระหว่าง Owner authentication กับ permission lease —
 * grant authority ได้ก็ต่อเมื่อมี Owner session ที่พิสูจน์ตัวตนจริง (ไม่ใช่สตริง "OWNER")
 *
 * physical Owner → authenticateOwner → OwnerSession → grantAuthorityAsOwner → lease
 *
 * Dependency ที่อนุญาต: ./authenticate.ts, ../computer-use-authority/contract.ts.
 */

import { validateOwnerSession } from "./authenticate";
import type { OwnerAuthDeps } from "./authenticate";
import { grantAuthority } from "../computer-use-authority/contract";
import type { GrantAuthorityInput, GrantAuthorityResult } from "../computer-use-authority/contract";

export type OwnerGrantResult =
  | GrantAuthorityResult
  | { ok: false; reason_code: string; detail: string };

/**
 * grant lease ในนามของ Owner ที่พิสูจน์ตัวตนแล้ว
 * owner ของ lease ถูกบังคับให้เป็น owner_identity ของ session — ไม่รับ owner ที่ผู้เรียกกรอกเอง
 */
export function grantAuthorityAsOwner(
  session_id: string,
  input: Omit<GrantAuthorityInput, "owner">,
  authDeps?: OwnerAuthDeps,
  grant: typeof grantAuthority = grantAuthority,
): OwnerGrantResult {
  const s = authDeps ? validateOwnerSession(session_id, authDeps) : validateOwnerSession(session_id);
  if (!s.ok) return { ok: false, reason_code: `OWNER_${s.reason_code}`, detail: s.detail };
  return grant({ ...input, owner: `owner-session:${s.session.session_id}:${s.session.owner_identity}` });
}
