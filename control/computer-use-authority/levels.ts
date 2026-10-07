/**
 * หน้าที่: จัดระดับความเสี่ยงของ computer-use operation (LEVEL 0-4) และนิยามกฎว่า
 * ระดับสูงต้อง "อำนาจชัดแจ้งแยก" ไม่สืบทอดจาก lease ของ click/type
 *
 * LEVEL 0 READ          screenshot, read_screen, browser_eval-READONLY (คุมที่ผู้เรียก)
 * LEVEL 1 UI CONTROL    focus, scroll, click, type, key
 * LEVEL 2 DATA WRITE    file_upload, clipboard, browser_eval (DOM write), browser_navigate
 * LEVEL 3 EXTERNAL COMMIT  submit/publish/send/delete/deploy/payment  (ผูกผ่านธง is_external_commit)
 * LEVEL 4 SECURITY/CRED    login, credential_reference, provider_authorization
 *
 * กฎ: LEVEL >= 3 ต้องมี `high_risk_explicit` บน lease; external commit ต้องมี
 * `external_commit_authorized` — ไม่มีทางได้อัตโนมัติจากสิทธิ์ UI control
 *
 * Dependency ที่อนุญาต: ./types.ts. ไม่มี side effect.
 */

import type { ComputerUseOperation } from "./types";

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export const OPERATION_LEVEL: Record<ComputerUseOperation, RiskLevel> = {
  screenshot: 0, read_screen: 0,
  focus: 1, scroll: 1, click: 1, type: 1, key: 1, drag: 1, pointer_move: 1, double_click: 1,
  file_chooser: 2, file_upload: 2, clipboard: 2, browser_navigate: 2, browser_eval: 2,
  // NB: browser_eval ค่าเริ่มต้นเป็น L2 (อาจเขียน DOM) — READ-ONLY เป็นความรับผิดชอบของ
  // ผู้เรียกที่ประกาศ is_read_only; executor ไม่เดา
  login: 4, credential_reference: 4, provider_authorization: 4,
};

export function levelOf(op: ComputerUseOperation): RiskLevel {
  return OPERATION_LEVEL[op] ?? 4; // ไม่รู้จัก = ถือว่าเสี่ยงสูงสุด (fail closed)
}

/** operation ระดับ 4 (security/credential) — ต้อง dedicated authorization เสมอ */
export function isSecurityLevel(op: ComputerUseOperation): boolean {
  return levelOf(op) >= 4;
}

/** operation ที่ต้อง explicit high-risk authority (>= LEVEL 3) */
export function requiresExplicitHighRisk(op: ComputerUseOperation): boolean {
  return levelOf(op) >= 3;
}
