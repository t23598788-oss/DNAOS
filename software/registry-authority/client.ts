/**
 * ฝั่งผู้ขอ — วางคำขอลงที่พัก แล้วรอผลจากผู้มีอำนาจ
 * ไม่มีทางเขียน canonical registry ตรงจากที่นี่ และไม่มีทางระบุ path ปลายทาง
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AuthorityOperation, AuthorityResult } from "./protocol";

export interface SubmitInput {
  readonly requester: string;
  readonly operation: AuthorityOperation;
  readonly table: string;
  readonly row: Record<string, unknown>;
}

export function submitAuthorityRequest(spoolDir: string, input: SubmitInput): string {
  const inbox = join(spoolDir, "inbox");
  if (!existsSync(inbox)) mkdirSync(inbox, { recursive: true });
  const request_id = `req-${randomUUID()}`;
  writeFileSync(join(inbox, `${request_id}.json`), JSON.stringify({
    request_id, created_at: new Date().toISOString(),
    requester: input.requester, operation: input.operation, table: input.table, row: input.row,
  }));
  return request_id;
}

export function readAuthorityResult(spoolDir: string, requestId: string): AuthorityResult | null {
  const f = join(spoolDir, "results", `${requestId}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")) as AuthorityResult; } catch { return null; }
}
