/**
 * หน้าที่: หาชิ้นส่วนที่เอามาทดลองได้จริง จากความสัมพันธ์ที่ DNA OS รู้อยู่แล้ว
 *
 * ── ไม่มีสัญญาที่ประกาศไว้ ไม่ได้แปลว่ารันไม่ได้ ──
 * ความสามารถ 92 ตัวที่ถูกจัดเป็นโครงสร้างพื้นฐาน ถูกจัดแบบนั้นเพราะ "ไม่มีทางเข้า
 * ที่ประกาศไว้" ซึ่งเป็นช่องว่างของความรู้ ไม่ใช่ข้อพิสูจน์ว่ามันทำอะไรไม่ได้
 * ชิ้นส่วนจึงเข้าชุดทดลองได้โดยไม่ต้องมีสัญญา
 *
 * ── ไม่ไล่หาไฟล์เอง ──
 * ทุก path มาจาก `resources.jsonl` ที่ทะเบียนผูกไว้กับความสามารถอยู่แล้ว
 * โฟลเดอร์ถูกแปลงเป็นจุดเข้าด้วยกฎเดียวของระบบนี้ (`contract.ts` คือขอบเขต
 * สาธารณะตาม CAPABILITY_FOLDER_LAW) ไม่ใช่การเดาว่าไฟล์ไหนน่าจะใช่
 *
 * Input: machine model + registry
 * Output: `resolveExperimentalComponents`
 * Dependency ที่อนุญาต: ./composition.ts, ./operation-algebra.ts (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามเปิดอ่านเนื้อไฟล์ซอร์ส ห้ามเดา entry จากชื่อไฟล์อื่น
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { capabilityContracts } from "./composition";
import { classifyCapabilityLevels } from "./operation-algebra";
import { invocationOfCapability } from "./invocation";
import type { MachineModel } from "./model";
import type { DependencyIndex } from "./dependency-index";
import type { CapabilityLevel } from "./operation-algebra";

const RESOURCES = "software/registry-database/data/canonical/resources.jsonl";

export interface ExperimentalComponent {
  readonly component_id: string;
  readonly capability_id: string;
  readonly level: CapabilityLevel;
  readonly implementation_id: string;
  readonly resource_id: string;
  readonly entry_path: string | null;
  readonly known_entry_boundary: readonly string[];
  readonly known_runtime_requirements: readonly string[];
  readonly known_technical_connections: readonly string[];
  readonly existing_execution_evidence: readonly string[];
  readonly knowledge_gaps: readonly string[];
}

function readJsonl(rel: string): readonly Record<string, any>[] {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) return [];
  const out: Record<string, any>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (s.length === 0) continue;
    try { out.push(JSON.parse(s)); } catch { /* แถวเสียไม่ทำให้ทั้งชุดหาย */ }
  }
  return out;
}

/** โฟลเดอร์ -> ขอบเขตสาธารณะของมัน ตามกฎเดียวที่ระบบนี้ใช้อยู่ */
function entryFor(sourceLocation: string): string | null {
  const clean = sourceLocation.split(" ")[0];
  if (clean.endsWith(".ts") || clean.endsWith(".mjs")) return clean;
  const contract = `${clean.replace(/\/+$/, "")}/contract.ts`;
  return existsSync(join(process.cwd(), contract)) ? contract : null;
}

/** ชิ้นส่วนทั้งหมดที่เอาไปทดลองได้ พร้อมช่องว่างที่ยังไม่รู้ */
export function resolveExperimentalComponents(model: MachineModel, index: DependencyIndex): readonly ExperimentalComponent[] {
  const contracts = capabilityContracts(model, index);
  const levels = new Map(classifyCapabilityLevels(contracts, model, index).map((l) => [l.capability_id, l.level]));
  const sourceById = new Map(readJsonl(RESOURCES).map((r) => [String(r.resource_id), String(r.source_location ?? "")]));

  const out: ExperimentalComponent[] = [];
  for (const c of contracts) {
    const chain = invocationOfCapability(c.capability_id);
    for (const impl of c.implemented_by) {
      const resourceId = impl.replace("machine://FILES_PACKAGES/", "");
      const source = sourceById.get(resourceId);
      if (source === undefined) continue;
      const entry = entryFor(source);
      const gaps: string[] = [];
      if (entry === null) gaps.push("NO_RESOLVABLE_ENTRY_FILE");
      if (chain.entry_boundary.length === 0) gaps.push("NO_DECLARED_ENTRY_BOUNDARY");
      if (c.input_contract.length === 0) gaps.push("NO_DECLARED_INPUT_CONTRACT");
      if (c.output_contract.length === 0) gaps.push("NO_DECLARED_OUTPUT_CONTRACT");
      out.push({
        component_id: `component:${c.capability_id}:${resourceId}`,
        capability_id: c.capability_id,
        level: levels.get(c.capability_id) ?? "UNCLASSIFIED",
        implementation_id: impl, resource_id: resourceId, entry_path: entry,
        known_entry_boundary: chain.entry_boundary,
        known_runtime_requirements: chain.process_service,
        known_technical_connections: index.dependenciesOf(`machine://CAPABILITIES/${c.capability_id}`).map((d) => d.depends_on),
        existing_execution_evidence: chain.observed_evidence,
        knowledge_gaps: gaps,
      });
    }
  }
  return out;
}
