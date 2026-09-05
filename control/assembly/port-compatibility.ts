/**
 * หน้าที่: ตัดสินว่า port สองข้างต่อกันได้ไหม แบบกำหนดผลแน่นอน
 *
 * Owner, 2026-09-05 ข้อ 5: "ห้าม Agent เป็นคนตัดสิน compatibility"
 * ไฟล์นี้จึงเป็นผู้ตัดสินเพียงผู้เดียว และไม่มีการเรียกโมเดลภาษาใด ๆ
 *
 * ข้อ 4 ยังบังคับด้วยว่า "ห้าม connector ต่อกันเพราะชื่อ field คล้ายกัน" —
 * การเทียบจึงดูที่ schema_id, เวอร์ชัน และ identity field ไม่ใช่ความคล้ายของชื่อ
 *
 * Input: port ฝั่งผลิต + port ฝั่งบริโภค
 * Output: COMPATIBLE | ADAPTER_REQUIRED | INCOMPATIBLE | UNKNOWN พร้อมเหตุผลรายข้อ
 * Dependency ที่อนุญาต: ./types.ts ./registry.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามถือว่า UNKNOWN เท่ากับผ่าน
 * - ห้ามเทียบ schema ด้วยความคล้ายของชื่อฟิลด์
 */

import { contractById } from "./registry";
import type { DataContractV1, JsonSchemaLike, PortContract } from "./types";

export type CompatibilityVerdict = "COMPATIBLE" | "ADAPTER_REQUIRED" | "INCOMPATIBLE" | "UNKNOWN";

export interface CheckResult {
  readonly check: string;
  readonly verdict: CompatibilityVerdict;
  readonly detail: string;
}

export interface PortCompatibilityResult {
  readonly producer_port: string;
  readonly consumer_port: string;
  readonly verdict: CompatibilityVerdict;
  readonly checks: readonly CheckResult[];
  readonly blocking: readonly string[];
}

/** ลำดับความรุนแรง — ผลรวมคือค่าที่แย่ที่สุดในบรรดาผลย่อย */
const RANK: Record<CompatibilityVerdict, number> = {
  COMPATIBLE: 0, ADAPTER_REQUIRED: 1, UNKNOWN: 2, INCOMPATIBLE: 3,
};
const worst = (a: CompatibilityVerdict, b: CompatibilityVerdict) => (RANK[a] >= RANK[b] ? a : b);

/** เทียบ schema แบบโครงสร้าง: ผู้บริโภคต้องได้ required ครบ และชนิดต้องตรง */
function schemaSatisfies(produced: JsonSchemaLike, required: JsonSchemaLike): { ok: boolean; missing: string[]; mismatched: string[] } {
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const field of required.required ?? []) {
    const need = required.properties?.[field];
    const have = produced.properties?.[field];
    if (have === undefined) { missing.push(field); continue; }
    if (need !== undefined && need.type !== have.type) mismatched.push(`${field}: ต้องการ ${need.type} แต่ได้ ${have.type}`);
    if (need?.enum && have.enum) {
      const extra = have.enum.filter((v) => !need.enum!.includes(v));
      if (extra.length > 0) mismatched.push(`${field}: ค่าที่ผลิตได้มีนอกเหนือที่ผู้บริโภครับ (${extra.join(", ")})`);
    }
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

/** เวอร์ชันแบบ major.minor — major ต่างกันคือ breaking */
function versionCheck(a: string, b: string): CompatibilityVerdict {
  const [aMaj] = a.split(".");
  const [bMaj] = b.split(".");
  if (aMaj === "" || bMaj === "") return "UNKNOWN";
  return aMaj === bMaj ? "COMPATIBLE" : "INCOMPATIBLE";
}

export function checkPortCompatibility(
  producer: PortContract,
  consumer: PortContract,
  context: { availableResources?: readonly string[]; grantedAuthority?: readonly string[] } = {},
): PortCompatibilityResult {
  const checks: CheckResult[] = [];
  const add = (check: string, verdict: CompatibilityVerdict, detail: string) => checks.push({ check, verdict, detail });

  // ทิศทาง
  if (producer.direction !== "OUT" || consumer.direction !== "IN") {
    add("direction", "INCOMPATIBLE", `ต้องเป็น OUT -> IN แต่ได้ ${producer.direction} -> ${consumer.direction}`);
  } else add("direction", "COMPATIBLE", "OUT -> IN");

  // transport
  if (producer.transport === consumer.transport) add("transport", "COMPATIBLE", producer.transport);
  else add("transport", "ADAPTER_REQUIRED", `${producer.transport} -> ${consumer.transport} ต้องมีตัวแปลง`);

  // schema
  const outRef = producer.output_schema_ref;
  const inRef = consumer.input_schema_ref;
  if (outRef === null || inRef === null) {
    add("schema", "UNKNOWN", "ปลายใดปลายหนึ่งยังไม่ประกาศ schema — ตัดสินไม่ได้ ไม่ใช่ผ่าน");
  } else if (outRef === inRef) {
    add("schema", "COMPATIBLE", `schema เดียวกัน (${outRef})`);
  } else {
    const p: DataContractV1 | null = contractById(outRef);
    const c: DataContractV1 | null = contractById(inRef);
    if (p === null || c === null) add("schema", "UNKNOWN", `หา contract ไม่เจอ: ${p === null ? outRef : inRef}`);
    else {
      const r = schemaSatisfies(p.json_schema, c.json_schema);
      if (r.ok) add("schema", "ADAPTER_REQUIRED", `โครงสร้างครอบคลุมแต่คนละ schema_id (${outRef} -> ${inRef})`);
      else add("schema", "INCOMPATIBLE", `ขาด ${r.missing.join(", ") || "-"} · ไม่ตรงชนิด ${r.mismatched.join("; ") || "-"}`);
    }
  }

  // identity — ต้องพูดถึงของชิ้นเดียวกัน ไม่ใช่แค่รูปร่างเหมือนกัน
  if (outRef !== null && inRef !== null) {
    const p = contractById(outRef); const c = contractById(inRef);
    if (p === null || c === null) add("identity", "UNKNOWN", "ไม่มี contract ให้เทียบ identity");
    else {
      const shared = c.identity_fields.filter((f) => p.identity_fields.includes(f));
      if (c.identity_semantics === "VALUE_OBJECT") add("identity", "COMPATIBLE", "เป็นค่าที่คำนวณได้ ไม่มีตัวตนของตัวเองโดยเจตนา");
      else if (c.identity_fields.length === 0) add("identity", "UNKNOWN", "ประกาศเป็น ENTITY แต่ไม่มี identity field — ตัดสินไม่ได้");
      else if (shared.length === c.identity_fields.length) add("identity", "COMPATIBLE", `ตรงกัน: ${shared.join(", ")}`);
      else add("identity", "ADAPTER_REQUIRED", `ต้อง map identity: ผู้บริโภคต้องการ ${c.identity_fields.join(", ")}`);
    }
  }

  // version
  add("version", versionCheck(producer.contract_version, consumer.contract_version),
    `${producer.contract_version} -> ${consumer.contract_version}`);

  // authority — ผู้บริโภคต้องไม่ต้องการสิทธิ์สูงกว่าที่ได้รับมอบ
  if (context.grantedAuthority === undefined) {
    add("authority", "UNKNOWN", `ยังไม่ได้ระบุสิทธิ์ที่มี (port ต้องการ ${consumer.authority_class})`);
  } else if (consumer.authority_class === "NONE" || context.grantedAuthority.includes(consumer.authority_class)) {
    add("authority", "COMPATIBLE", consumer.authority_class);
  } else {
    add("authority", "INCOMPATIBLE", `ต้องการ ${consumer.authority_class} ซึ่งยังไม่ได้รับมอบ`);
  }

  // side effect — ผู้ผลิตที่อ่านอย่างเดียวป้อนผู้บริโภคที่เขียนได้ ไม่ใช่ปัญหา
  // แต่ผู้ผลิตที่มีผลทางการเงินต่อเข้าปลายทางที่ประกาศว่าไม่มีผล คือความไม่ตรงกัน
  if (producer.side_effect_class === "FINANCIAL" && consumer.side_effect_class === "PURE") {
    add("side_effect", "INCOMPATIBLE", "ต้นทางมีผลทางการเงินแต่ปลายทางประกาศว่าไม่มีผลใด ๆ");
  } else add("side_effect", "COMPATIBLE", `${producer.side_effect_class} -> ${consumer.side_effect_class}`);

  // runtime availability
  const unavailable = [producer, consumer].filter((p) => p.status === "UNAVAILABLE").map((p) => p.port_id);
  const unknownStatus = [producer, consumer].filter((p) => p.status === "UNKNOWN").map((p) => p.port_id);
  if (unavailable.length > 0) add("availability", "INCOMPATIBLE", `port ใช้งานไม่ได้: ${unavailable.join(", ")}`);
  else if (unknownStatus.length > 0) add("availability", "UNKNOWN", `สถานะไม่ทราบ: ${unknownStatus.join(", ")}`);
  else add("availability", "COMPATIBLE", "ทั้งสองฝั่งพร้อม");

  // resource
  const needed = [...new Set([...producer.availability_requirement, ...consumer.availability_requirement])];
  if (needed.length === 0) add("resource", "COMPATIBLE", "ไม่ต้องการทรัพยากรภายนอก");
  else if (context.availableResources === undefined) add("resource", "UNKNOWN", `ต้องการ ${needed.join(", ")} แต่ยังไม่ได้ระบุว่ามีอะไรพร้อม`);
  else {
    const missing = needed.filter((n) => !context.availableResources!.includes(n));
    if (missing.length === 0) add("resource", "COMPATIBLE", needed.join(", "));
    else add("resource", "INCOMPATIBLE", `ทรัพยากรไม่พร้อม: ${missing.join(", ")}`);
  }

  const verdict = checks.reduce<CompatibilityVerdict>((acc, c) => worst(acc, c.verdict), "COMPATIBLE");
  return {
    producer_port: producer.port_id, consumer_port: consumer.port_id, verdict, checks,
    blocking: checks.filter((c) => c.verdict === "INCOMPATIBLE" || c.verdict === "UNKNOWN").map((c) => `${c.check}: ${c.detail}`),
  };
}
