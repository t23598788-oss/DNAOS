/**
 * หน้าที่: **ครึ่งที่ยังไม่มีเจ้าของ** ของ event translator
 *
 * `control/work-continuation/adapter.ts` แปลง "ข้อเท็จจริงระดับระบบ" จาก
 * live-census / registry / verification เป็น `DependencyEvent` แล้ว แต่ 5 ใน 10
 * namespace ที่ประตูของโฟลเดอร์นี้บันทึกไว้ **ไม่มีผู้ผลิต event เลย**:
 *
 *   trigger · routing · caller · consumer · contract_field
 *
 * ทั้งห้าไม่ใช่ข้อเท็จจริงเรื่อง "ของมีอยู่ไหม" แต่เป็นข้อเท็จจริงเรื่อง **การต่อสาย**
 * (มีอะไรเรียกถึงจริงไหม · มีเส้นทางไหม · ช่องในสัญญาถูกเติมหรือยัง) ซึ่งไม่มี
 * ผู้สังเกตใดในระบบปล่อยออกมาเป็น event งานที่บล็อกด้วย key พวกนี้จึงรอตลอดกาล
 * — พฤติกรรมถูก (ไม่ปลุกมั่ว) แต่ไม่มีวันจบ ไฟล์นี้ปิดช่องนั้น
 *
 * **ไม่ได้สร้างผู้สังเกตตัวใหม่** มันไม่เฝ้าดูอะไรเลย: มันเรียกประตูตัวเดิม
 * (`evaluateCompletionGate`) กับสถานะจริง ณ ตอนนี้ แล้วเทียบกับสิ่งที่เคยขาด
 * key ที่ "เคยขาดและตอนนี้ไม่ขาดแล้ว" เท่านั้นที่กลายเป็น event
 *
 * Input: creation record ที่บันทึกไว้ + สถานะจริงของ repo/census ณ ตอนนี้
 * Output: `deriveWiringEvents`, `wiringFactsSatisfied`
 * Dependency ที่อนุญาต: ./gate.ts, ./store.ts, ./types.ts และ
 * `../work-continuation/contract.ts` (ใช้ `dependencyKey` และ shape ของ
 * `DependencyEvent` — **ห้ามสร้าง key constructor หรือ event shape ที่สอง**)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามปล่อย event จากหลักฐานที่ยังไม่ครบ — key ที่ยังขาดอยู่ต้องเงียบ
 * - ห้ามปล่อย event เพราะ "น่าจะพร้อมแล้ว" — ต้องผ่านการตรวจของประตูตัวเดิม
 * - ห้ามให้ AI ตัดสินว่า fact ไหนพอใจแล้ว — เทียบจากผลของประตู ไม่ใช่การอ่าน
 */
import type { DependencyEvent } from "../work-continuation/contract";
import { evaluateCompletionGate, type CompletionGateInput } from "./gate";
import { incompleteCapabilities, type CreationRecord } from "./store";

/** The five namespaces this file is the producer for. Nothing else emits them. */
export const WIRING_NAMESPACES = ["trigger", "routing", "caller", "consumer", "contract_field"] as const;

function namespaceOf(key: string): string {
  return key.split(":")[0] ?? "";
}

/**
 * ตรวจ record หนึ่งอันซ้ำกับของจริง แล้วคืน key ที่ **เคยขาดและตอนนี้ไม่ขาดแล้ว**
 *
 * `probe` คือหลักฐานปัจจุบันที่ผู้เรียกหามาให้ (มี runtime evidence ไหม,
 * Registry ออก id หรือยัง, verification รันแล้วผลเป็นอะไร) — ไฟล์นี้ไม่ไปหาเอง
 * เพราะการหาเองคือการเป็นผู้สังเกตตัวที่สอง
 */
export function wiringFactsSatisfied(
  record: CreationRecord,
  probe: Pick<CompletionGateInput, "entry_symbol" | "runtime_invocation_evidence" | "registered" | "verification">,
): { satisfied: readonly string[]; still_missing: readonly string[]; state: string } {
  const before = new Set(record.gate.missing.map((m) => m.blocked_on).filter((k): k is string => typeof k === "string"));
  const now = evaluateCompletionGate({ contract: record.contract, ...probe });
  const stillMissing = new Set(now.missing.map((m) => m.blocked_on).filter((k): k is string => typeof k === "string"));
  const satisfied = Array.from(before).filter((k) => !stillMissing.has(k));
  return { satisfied, still_missing: Array.from(stillMissing), state: now.state };
}

export interface WiringProbe extends Pick<CompletionGateInput, "entry_symbol" | "runtime_invocation_evidence" | "registered" | "verification"> {
  capability_name: string;
}

/**
 * แปลง "การต่อสายที่เพิ่งครบ" เป็น `DependencyEvent`
 *
 * `source_revision` ถูกใส่ไว้ใน `evidence_ref` เพราะ `DependencyEvent` ที่มีอยู่
 * มีห้าช่องพอดี — การเพิ่มช่องที่หกจะเป็นการแตะ contract ของ capability อื่น
 * เพื่อความสะดวกของไฟล์นี้ ซึ่งไม่คุ้ม
 *
 * `value` = สถานะ lifecycle ที่ไปถึงจริงตอนตรวจซ้ำ ไม่ใช่ `"OK"` — ผู้บริโภคที่
 * ใช้ `EXACT_STATE` จะได้เทียบกับของจริง
 */
export function deriveWiringEvents(
  probes: readonly WiringProbe[],
  observedAt: string,
  options: { path?: string; source_revision?: string } = {},
): DependencyEvent[] {
  const records = new Map(incompleteCapabilities(options.path).map((r) => [r.capability_name, r]));
  const out: DependencyEvent[] = [];
  const revision = options.source_revision ?? "UNKNOWN_REVISION";

  for (const probe of probes) {
    const record = records.get(probe.capability_name);
    if (!record) continue; // nothing was ever recorded as missing for this capability
    const { satisfied, state } = wiringFactsSatisfied(record, probe);
    for (const key of satisfied) {
      const ns = namespaceOf(key);
      // ONLY the five namespaces this file is the producer for. The others
      // already have a producer in control/work-continuation/adapter.ts, and a
      // second producer for the same fact is exactly the duplication the Owner
      // forbade — it would also let this file's weaker evidence satisfy a key
      // that the real producer would have refused.
      if (!(WIRING_NAMESPACES as readonly string[]).includes(ns)) continue;
      out.push({
        key,
        value: state,
        source: "capability-creation",
        evidence_ref: `gate:${record.capability_name}@${revision} re-checked ${observedAt}`,
        occurred_at: observedAt,
      });
    }
  }
  return out;
}
