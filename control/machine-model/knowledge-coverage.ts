/**
 * หน้าที่: บอกว่าตอนนี้ DNA OS ตอบอะไรเกี่ยวกับร่างกายตัวเองได้แน่ ๆ และอะไรยังไม่รู้
 *
 * ── ช่องว่างต้องมีชื่อ ──
 * ชนิดข้อเท็จจริงที่ควรมีถูกประกาศไว้ล่วงหน้าใน `EXPECTED_FACT_TYPES` ถ้าไม่
 * ประกาศไว้ก่อน สิ่งที่บังเอิญเก็บได้จะกลายเป็น "ครบแล้ว" โดยอัตโนมัติ และช่องว่าง
 * จะไม่มีวันปรากฏ
 *
 * ── ห้ามเติมช่องว่างด้วยการเดา ──
 * `MODEL_GAP` คือคำตอบสุดท้ายของชั้นนี้ ไม่มีทางใดในไฟล์นี้เรียกโมเดลภาษา
 * ไม่มีค่าเริ่มต้น และไม่มีการอนุมานจากชนิดอื่นที่ใกล้เคียง
 *
 * Input: `MachineModel` + ผลการสำรวจ
 * Output: `knowledgeCoverage`, `EXPECTED_FACT_TYPES`
 * Dependency ที่อนุญาต: ./model.ts, ./census.ts (type)
 * สิ่งที่ห้ามแตะ: ห้ามเดาข้อเท็จจริงที่วัดไม่ได้ ห้ามเขียนไฟล์
 */

import type { MachineModel } from "./model";
import type { LayerId } from "./layers";

/** ชนิดข้อเท็จจริงที่แต่ละชั้นควรตอบได้ — ประกาศก่อน ไม่ใช่สรุปย้อนหลัง */
export const EXPECTED_FACT_TYPES: Readonly<Partial<Record<LayerId, readonly string[]>>> = {
  HARDWARE_OS: [
    "HARDWARE_MODEL", "ARCHITECTURE", "CPU", "CPU_COUNT", "PHYSICAL_MEMORY_BYTES",
    "STORAGE_VOLUME", "NETWORK_INTERFACE",
    "OS_FAMILY", "OS_VERSION", "OS_BUILD", "KERNEL_VERSION", "BOOT_TIME", "UPTIME_SECONDS",
  ],
  INSTALLED_SOFTWARE: [
    "APPLICATION", "CLI_TOOL", "PACKAGE", "SYSTEM_COMPONENT", "RUNTIME", "BACKGROUND_SERVICE",
  ],
  LOCAL_DATABASES: ["DATABASE_ENGINE", "DATABASE_INSTANCE", "DATABASE", "LOCAL_DATA_STORE"],
};

export interface LayerKnowledge {
  readonly layer_id: LayerId;
  readonly expected_fact_types: readonly string[];
  readonly observed_fact_types: readonly string[];
  readonly coverage: string;
  readonly model_gaps: readonly string[];
}

export interface KnowledgeReport {
  readonly machine_id: string | null;
  readonly layers: readonly LayerKnowledge[];
  readonly model_gaps: readonly string[];
}

/** อะไรที่ตอบได้แน่ ๆ ตอนนี้ และอะไรที่ยังไม่รู้ */
export function knowledgeCoverage(model: MachineModel): KnowledgeReport {
  const machineId = model.machine_id;

  // อ่านจากโมเดลที่ส่งเข้ามา ไม่ใช่ไปสำรวจใหม่
  //
  // ถ้าไปเรียกการสำรวจเอง รายงานจะบอกว่ารู้ในสิ่งที่โมเดลใบนี้ไม่มี — กลายเป็น
  // การรายงานความรู้ของเครื่อง แทนที่จะรายงานความรู้ของโมเดลที่ผู้เรียกถืออยู่
  const observed = new Map<LayerId, Set<string>>();
  for (const node of model.nodes) {
    const prefix = `machine://${node.layer_id}/`;
    if (!node.node_id.startsWith(prefix)) continue;
    const factType = node.node_id.slice(prefix.length).split("/")[0];
    const set = observed.get(node.layer_id) ?? new Set<string>();
    set.add(factType);
    observed.set(node.layer_id, set);
  }

  const layers: LayerKnowledge[] = [];
  const allGaps: string[] = [];
  for (const [layerId, expected] of Object.entries(EXPECTED_FACT_TYPES) as [LayerId, readonly string[]][]) {
    const seen = observed.get(layerId) ?? new Set<string>();
    const gaps = expected.filter((t) => !seen.has(t));
    layers.push({
      layer_id: layerId,
      expected_fact_types: expected,
      observed_fact_types: expected.filter((t) => seen.has(t)),
      coverage: `${expected.length - gaps.length}/${expected.length}`,
      model_gaps: gaps,
    });
    allGaps.push(...gaps.map((g) => `${layerId}:${g}`));
  }
  return { machine_id: machineId, layers, model_gaps: allGaps };
}
