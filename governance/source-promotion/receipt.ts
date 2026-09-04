/**
 * ใบรับรองการเลื่อนขั้น — หลักฐานว่าการเปลี่ยนแปลงหนึ่งผ่านครบทุกด่านแล้ว
 *
 * เกิดขึ้นเพราะเส้นทางเดิมขาดสองด่าน: การเลื่อนขั้น และการทดสอบ
 * Write Gate ตอบว่า "ใครเป็นเจ้าของ" · กฎโฟลเดอร์ตอบว่า "วางถูกที่ไหม"
 * แต่ไม่มีใครตอบว่า "การเปลี่ยนแปลงนี้ถูกตรึงและทดสอบแล้วหรือยัง"
 *
 * ใบรับรองผูกสามอย่างเข้าด้วยกันแบบแยกไม่ออก
 *   manifest ที่ตรึงแล้ว (ของ freeze.ts)
 *   แฮชของเนื้อหาที่จะเขียนจริง
 *   ผลการทดสอบจากภายนอก
 *
 * ใบหนึ่งใช้ได้ครั้งเดียว และใช้ได้เฉพาะกับเนื้อหาที่แฮชตรงเป๊ะ
 * เปลี่ยนเนื้อหาแม้ไบต์เดียว ใบเดิมใช้ไม่ได้อีก
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const STORE = "governance/source-promotion/data/promotion-receipts.jsonl";

export type TestGateOutcome = "PASS" | "FAIL" | "NOT_RUN";

export interface PromotionReceipt {
  readonly receipt_id: string;
  readonly issued_at: string;
  readonly change_id: string;
  readonly manifest_sha256: string;
  /** path ที่อนุญาต -> sha256 ของเนื้อหาที่อนุญาตให้เขียน */
  readonly approved: readonly { readonly path: string; readonly content_sha256: string }[];
  readonly test_gate: {
    readonly outcome: TestGateOutcome;
    readonly command: string;
    readonly evidence_ref: string;
  };
  readonly consumed: boolean;
}

export const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

function readAll(): PromotionReceipt[] {
  if (!existsSync(STORE)) return [];
  const latest = new Map<string, PromotionReceipt>();
  for (const line of readFileSync(STORE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { const r = JSON.parse(t) as PromotionReceipt; latest.set(r.receipt_id, r); } catch { /* ข้ามบรรทัดเสีย */ }
  }
  return [...latest.values()];
}

function append(r: PromotionReceipt): void {
  if (!existsSync(dirname(STORE))) mkdirSync(dirname(STORE), { recursive: true });
  appendFileSync(STORE, `${JSON.stringify(r)}\n`);
}

export type IssueResult =
  | { readonly ok: true; readonly receipt: PromotionReceipt }
  | { readonly ok: false; readonly reason_code: string; readonly detail: string };

/** ออกใบรับรอง — ปฏิเสธถ้าด่านทดสอบยังไม่ผ่าน */
export function issuePromotionReceipt(input: {
  change_id: string; manifest_sha256: string;
  approved: readonly { path: string; content_sha256: string }[];
  test_gate: { outcome: TestGateOutcome; command: string; evidence_ref: string };
}): IssueResult {
  if (input.test_gate.outcome !== "PASS") {
    return { ok: false, reason_code: "TEST_GATE_NOT_PASSED",
      detail: `ด่านทดสอบให้ผล ${input.test_gate.outcome} — ออกใบรับรองไม่ได้` };
  }
  if (input.approved.length === 0) return { ok: false, reason_code: "NO_APPROVED_TARGET", detail: "ไม่มีเป้าหมาย" };
  const receipt: PromotionReceipt = {
    receipt_id: `rcpt-${sha256(`${input.change_id}|${input.manifest_sha256}`).slice(0, 24)}`,
    issued_at: new Date().toISOString(),
    change_id: input.change_id, manifest_sha256: input.manifest_sha256,
    approved: input.approved.map((a) => ({ path: a.path, content_sha256: a.content_sha256 })),
    test_gate: input.test_gate, consumed: false,
  };
  append(receipt);
  return { ok: true, receipt };
}

export type ReceiptCheck =
  | { readonly ok: true; readonly receipt: PromotionReceipt }
  | { readonly ok: false; readonly reason_code: string };

/** หาใบที่อนุญาตให้เขียน path นี้ ด้วยเนื้อหานี้ และยังไม่ถูกใช้ */
export function findUsableReceipt(targetPath: string, content: string): ReceiptCheck {
  const want = sha256(content);
  const all = readAll();
  const forPath = all.filter((r) => r.approved.some((a) => a.path === targetPath));
  if (forPath.length === 0) return { ok: false, reason_code: "NO_PROMOTION_RECEIPT" };
  const matching = forPath.filter((r) => r.approved.some((a) => a.path === targetPath && a.content_sha256 === want));
  if (matching.length === 0) return { ok: false, reason_code: "CONTENT_HASH_MISMATCH" };
  const unused = matching.find((r) => !r.consumed);
  if (unused === undefined) return { ok: false, reason_code: "RECEIPT_ALREADY_CONSUMED" };
  return { ok: true, receipt: unused };
}

/** ทำเครื่องหมายว่าใช้แล้ว — ใบหนึ่งใช้ได้ครั้งเดียว */
export function consumeReceipt(receiptId: string): void {
  const r = readAll().find((x) => x.receipt_id === receiptId);
  if (r === undefined) return;
  append({ ...r, consumed: true });
}
