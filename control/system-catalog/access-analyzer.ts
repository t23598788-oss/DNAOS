/**
 * หน้าที่: หาว่าใครอ่านและใครเขียน data object แต่ละตัว จากซอร์สจริง
 *
 * Owner, 2026-09-05 ข้อ 4: ต้องหา "ข้อมูลที่เดินไม่สุด" — เขียนแล้วไม่มีใครอ่าน
 * อ่านแต่ไม่มีใครเขียน คิวที่ไม่มีคนทำงาน ฯลฯ คำตอบพวกนี้ต้องคำนวณจากซอร์ส
 * ไม่ใช่ความรู้สึกของผู้เขียนเอกสาร
 *
 * Input: ข้อความทั้งไฟล์
 * Output: การเข้าถึงแต่ละครั้ง พร้อมชนิดของ operation
 * Dependency ที่อนุญาต: ./extractor-rules.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเดา operation จากชื่อ object
 * - ห้ามถือว่า "ไม่พบ operation" เท่ากับ "อ่าน"
 */

import { classifyFromCalls } from "./extractor-rules";

export type AccessOperation = "READ" | "WRITE" | "DELETE" | "UNKNOWN_OPERATION";

export interface AccessSite {
  readonly object: string;
  readonly kind: "TABLE" | "STORAGE_BUCKET";
  readonly operation: AccessOperation;
  readonly file: string;
  readonly line: number;
  readonly evidence: string;
}

/** คำที่ตามหลัง .from("x") แล้วบอกว่าทำอะไรกับมัน */
const OP_PATTERNS: readonly [RegExp, AccessOperation][] = [
  [/\.\s*(insert|upsert)\s*\(/, "WRITE"],
  [/\.\s*update\s*\(/, "WRITE"],
  [/\.\s*delete\s*\(/, "DELETE"],
  [/\.\s*(select|maybeSingle|single)\s*\(/, "READ"],
  // ฝั่ง storage
  [/\.\s*(upload|copy|move|createSignedUploadUrl)\s*\(/, "WRITE"],
  [/\.\s*remove\s*\(/, "DELETE"],
  [/\.\s*(download|list|createSignedUrl|getPublicUrl)\s*\(/, "READ"],
];

/** ระยะที่ยอมให้ operation อยู่ห่างจาก .from( — พอสำหรับ chain ที่ขึ้นบรรทัดใหม่ */
const LOOKAHEAD = 240;

export function analyzeFileAccess(text: string, file: string): readonly AccessSite[] {
  const out: AccessSite[] = [];
  const lines = text.split("\n");
  // ตำแหน่งเริ่มของแต่ละบรรทัดในข้อความรวม เพื่อมองข้ามบรรทัดได้
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) { offsets.push(acc); acc += l.length + 1; }

  lines.forEach((line, i) => {
    const refs = classifyFromCalls(line);
    if (refs.length === 0) return;
    for (const ref of refs) {
      const at = text.indexOf(ref.matched, offsets[i]);
      const window = at === -1 ? line : text.slice(at + ref.matched.length, at + ref.matched.length + LOOKAHEAD);
      let operation: AccessOperation = "UNKNOWN_OPERATION";
      let best = Number.MAX_SAFE_INTEGER;
      for (const [re, op] of OP_PATTERNS) {
        const m = window.match(re);
        if (m && m.index !== undefined && m.index < best) { best = m.index; operation = op; }
      }
      out.push({
        object: ref.name, kind: ref.kind, operation, file, line: i + 1,
        evidence: `${file}:${i + 1}`,
      });
    }
  });
  return out;
}

export interface ObjectAccessSummary {
  readonly object: string;
  readonly kind: "TABLE" | "STORAGE_BUCKET";
  readonly readers: readonly string[];
  readonly writers: readonly string[];
  readonly deleters: readonly string[];
  readonly unknown_sites: readonly string[];
}

export function summarize(sites: readonly AccessSite[]): readonly ObjectAccessSummary[] {
  const byObject = new Map<string, AccessSite[]>();
  for (const s of sites) {
    if (!byObject.has(s.object)) byObject.set(s.object, []);
    byObject.get(s.object)!.push(s);
  }
  const comp = (s: AccessSite) => s.file;
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  return [...byObject.entries()].map(([object, group]) => ({
    object,
    kind: group[0].kind,
    readers: uniq(group.filter((s) => s.operation === "READ").map(comp)),
    writers: uniq(group.filter((s) => s.operation === "WRITE").map(comp)),
    deleters: uniq(group.filter((s) => s.operation === "DELETE").map(comp)),
    unknown_sites: uniq(group.filter((s) => s.operation === "UNKNOWN_OPERATION").map((s) => s.evidence)),
  })).sort((a, b) => a.object.localeCompare(b.object));
}
