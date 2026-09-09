/**
 * หน้าที่: ตอบคำถามผลกระทบจาก drift ระหว่างซอร์สกับ production
 *
 * Owner, 2026-09-05 ข้อ 9: ชั้น query ต้องตอบได้ห้าคำถาม โดยอ่านจากหลักฐานที่
 * วัดมาแล้ว ไม่ใช่คำนวณใหม่ตอนถาม และไม่ใช่การเดา
 *
 * Input: ชื่อ object หรือไม่มี
 * Output: คำตอบที่อ้างหลักฐานได้
 * Dependency ที่อนุญาต: data/*.json ในโฟลเดอร์เดียวกัน + ./flow-verifier.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเดาว่า migration ใดควรถูก apply
 * - ห้ามตอบจาก migration เมื่อคำถามถามถึง production
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyFlow } from "./flow-verifier";
import type { RuntimeFlow } from "./flow-types";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data");
const FLOWS = join(HERE, "flows");

const read = <T>(name: string): T => JSON.parse(readFileSync(join(DATA, name), "utf-8")) as T;

interface DriftEntry {
  object_name: string; object_type: string; migration_source: string[];
  code_references: string[]; affected_components: string[]; affected_flows: string[];
  business_effect: string; repair_required: boolean; repair_type: string;
}
interface DriftCatalog {
  generated_at: string;
  source_only: DriftEntry[]; code_only: DriftEntry[];
  live_only: { object: string; type: string; counts_as_business_table: boolean;
    business_meaning: string; code_references: string[]; owner: string }[];
}

const drift = (): DriftCatalog => read<DriftCatalog>("schema-drift-catalog.json");
const classification = () => read<{ tables: Record<string, string[]>; buckets: Record<string, string[]> }>("from-call-classification.json");

const flows = (): readonly RuntimeFlow[] =>
  readdirSync(FLOWS).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(FLOWS, f), "utf-8")) as RuntimeFlow);

/** คำถาม 1: โค้ดที่ไหนคาดหวังตาราง X */
export function whoExpectsTable(table: string): {
  table: string; kind: "TABLE" | "STORAGE_BUCKET" | "NOT_REFERENCED";
  references: readonly string[]; components: readonly string[];
} {
  const c = classification();
  if (c.buckets[table]) {
    return { table, kind: "STORAGE_BUCKET", references: c.buckets[table],
      components: [...new Set(c.buckets[table].map((r) => r.replace(/:\d+$/, "")))] };
  }
  const refs = c.tables[table] ?? [];
  return { table, kind: refs.length > 0 ? "TABLE" : "NOT_REFERENCED", references: refs,
    components: [...new Set(refs.map((r) => r.replace(/:\d+$/, "")))] };
}

/** คำถาม 2: flow ไหนพังเพราะ object X ไม่มีจริง */
export function flowsBrokenBy(object: string): readonly {
  flow_id: string; sub_path_id: string | null; business_effect: string;
}[] {
  const out: { flow_id: string; sub_path_id: string | null; business_effect: string }[] = [];
  for (const f of flows()) {
    if (!(f.schema_missing_tables ?? []).includes(object)) continue;
    const subs = (f.sub_paths ?? []).filter((s) => s.missing_objects.includes(object));
    if (subs.length === 0) out.push({ flow_id: f.flow_id, sub_path_id: null, business_effect: f.output });
    for (const s of subs) out.push({ flow_id: f.flow_id, sub_path_id: s.sub_path_id, business_effect: s.business_effect });
  }
  return out;
}

/** คำถาม 3: object ใดมีเฉพาะใน production */
export function liveOnlyObjects(options: { businessOnly?: boolean } = {}) {
  const rows = drift().live_only;
  return options.businessOnly ? rows.filter((r) => r.counts_as_business_table) : rows;
}

/** คำถาม 4: migration ใดในซอร์สที่ production ไม่มี */
export function sourceMigrationsAbsentFromProduction(): readonly DriftEntry[] {
  return drift().source_only;
}

/** object ที่โค้ดคาดหวังแต่ไม่มีทั้งใน migration และใน production */
export function objectsExpectedByCodeOnly(): readonly DriftEntry[] {
  return drift().code_only;
}

/** คำถาม 5: อะไรยังรันไม่ได้ และเพราะอะไร */
export function notRuntimeEligible(): readonly {
  flow_id: string; failed_required_objects: readonly string[];
  reason: string; eligible_sub_paths: readonly string[];
}[] {
  const out: { flow_id: string; failed_required_objects: readonly string[]; reason: string; eligible_sub_paths: readonly string[] }[] = [];
  for (const f of flows()) {
    const v = verifyFlow(f);
    if (v.runtime_eligibility !== "NOT_ELIGIBLE") continue;
    out.push({
      flow_id: f.flow_id,
      failed_required_objects: v.failed_required_objects,
      reason: `object ที่จำเป็นไม่มีใน live schema: ${v.failed_required_objects.join(", ")}`,
      eligible_sub_paths: (f.sub_paths ?? []).filter((s) => s.runtime_eligibility === "ELIGIBLE").map((s) => s.sub_path_id),
    });
  }
  return out;
}

// ─── ข้อ 14: คำถามที่ DNA OS ต้องตอบได้หลัง normalization ────────────────────

interface Classified {
  object: string; data_class: string; layer: string; rule: string;
  readers: string[]; writers: string[]; deleters: string[];
}
const classified = (): Classified[] => read<{ objects: Classified[] }>("data-object-classification.json").objects;
const valueFlowDir = join(HERE, "value-flows");
const valueFlows = (): any[] =>
  readdirSync(valueFlowDir).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(valueFlowDir, f), "utf-8")));

/** ข้อมูลนี้มาจากไหน · ใครเขียน · ใครอ่าน · อยู่ layer ไหน */
export function provenanceOf(object: string) {
  const c = classified().find((x) => x.object === object) ?? null;
  if (c === null) return { object, known: false as const };
  return {
    object, known: true as const, data_class: c.data_class, layer: c.layer,
    classified_by: c.rule, written_by: c.writers, read_by: c.readers, deleted_by: c.deleters,
  };
}

/** มันควรไปไหนต่อ และมันหยุดอยู่ตรงไหน */
export function whereDoesItStop(object: string) {
  const stops: { flow_id: string; last_confirmed_stage: string | null; expected_next_stage: string | null; blocker: string | null }[] = [];
  for (const vf of valueFlows()) {
    const touches = vf.stages.some((s: any) => s.data_object.includes(object));
    if (!touches || vf.health === "COMPLETE") continue;
    stops.push({ flow_id: vf.flow_id, last_confirmed_stage: vf.last_confirmed_stage,
      expected_next_stage: vf.expected_next_stage, blocker: vf.blocker });
  }
  return stops;
}

/** หน้าไหนแสดงข้อมูลนี้ */
export function projectedOn(object: string) {
  const out: { flow_id: string; surface: string; refresh: string; reads_raw_ingestion: boolean }[] = [];
  for (const vf of valueFlows()) {
    for (const p of vf.projection) {
      if (p.canonical_source.includes(object) || p.projection_object.includes(object)) {
        out.push({ flow_id: vf.flow_id, surface: p.surface, refresh: p.refresh, reads_raw_ingestion: p.reads_raw_ingestion });
      }
    }
  }
  return out;
}

/** มันกระทบเงินอย่างไร */
export function financialEffectOf(object: string) {
  const out: { flow_id: string; effect: string; deterministic_calculation: string }[] = [];
  for (const vf of valueFlows()) {
    for (const m of vf.financial_effect) {
      if (m.data_object.includes(object)) out.push({ flow_id: vf.flow_id, effect: m.effect, deterministic_calculation: m.deterministic_calculation });
    }
  }
  return out;
}

/** มี object ไหนซ้ำ concept เดียวกัน */
export function duplicatesOf(object: string) {
  const groups = read<{ groups: any[] }>("duplicate-business-models.json").groups;
  return groups.filter((g) => g.legacy_objects.includes(object) || g.live_objects.includes(object));
}

/** ถ้าลบ object นี้ flow ไหนเสีย */
export function breakageIfRemoved(object: string) {
  const value = valueFlows().filter((vf) => vf.stages.some((s: any) => s.data_object.includes(object))).map((vf) => vf.flow_id);
  const provenance = provenanceOf(object);
  return { ...provenance, runtime_flows: flowsBrokenBy(object).map((f) => f.flow_id), value_flows: value };
}

/** ถ้า component นี้ตาย ข้อมูลค้างตรงไหน */
export function stallPointsIfComponentDies(component: string) {
  const rows = classified().filter((c) => c.writers.includes(component) || c.readers.includes(component));
  return rows.map((c) => ({
    object: c.object, data_class: c.data_class,
    role: c.writers.includes(component) ? "WRITER" : "READER",
    other_writers: c.writers.filter((w) => w !== component).length,
    other_readers: c.readers.filter((r) => r !== component).length,
    stalls: c.writers.includes(component) && c.writers.length === 1,
  }));
}

/** ข้อมูลที่เดินไม่สุด */
export function deadEnds(tag?: string) {
  const rows = read<{ dead_ends: any[] }>("dead-end-analysis.json").dead_ends;
  return tag ? rows.filter((r) => r.tags.includes(tag)) : rows;
}
