/**
 * หน้าที่: candidate ของ `software/system-graph/` — ของจริงที่ทำงานอยู่ใน
 * production แต่ยังไม่มีตัวตนในทะเบียน
 *
 * หลักฐานที่ทำให้อ้างได้ ไม่ใช่การประกาศ:
 *   ผู้เรียกจริง  transport/owner-command-http/server.ts:618 (dynamic import)
 *   endpoint จริง GET /graph/system ตอบ 200 พร้อม nodes=171 edges=481
 *   อ่านอย่างเดียว ไม่มี writeFileSync/appendFileSync ในทั้งสามไฟล์ของโฟลเดอร์
 *
 * `source_location` เป็น repo-relative โดยเจตนา — ไม่ใช่ absolute path ของเครื่อง
 * ตัวตนของซอฟต์แวร์ต้องไม่ขึ้นกับว่าใครเช็คเอาต์ไว้ที่ไหน
 *
 * Input: none (ค่าคงที่ค่าเดียว)
 * Output: `SYSTEM_GRAPH_PROJECTION_CANDIDATE`
 * Dependency ที่อนุญาต: type-only จาก control/event-pipeline/registration-contract.ts
 * สิ่งที่ห้ามแตะ: ห้ามแก้ `evidence_refs` ให้อ้างการรันที่ไม่ได้เกิดขึ้นจริง
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const SYSTEM_GRAPH_PROJECTION_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-system-graph-projection-v1",
  name: "system-graph-projection",
  kind: "capability",
  source_location: "software/system-graph/",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/system-graph-projection.ts",
  version: "1.0.0",

  input: [
    "none — อ่านจากผู้ผลิตที่มีอยู่แล้ว (ทะเบียน canonical, runtime service definitions) ไม่รับพารามิเตอร์ที่เปลี่ยนความจริง",
    "BuildOptions.probeServices?: boolean — เมื่อ true จะให้ผู้ผลิตยิง health probe จริง (ช้ากว่า) เป็นทางเลือก ไม่ใช่ค่าเริ่มต้น",
  ],
  output: [
    "SystemGraph: nodes[] (DOMAIN | CAPABILITY | SERVICE | PROVIDER), edges[], counts, sources[], unresolved[], generated_at",
    "ทุก node/edge มาจากผู้ผลิตที่มีอยู่จริง — ไม่มีการสร้าง node หรือ edge ขึ้นเอง และ unresolved[] บอกสิ่งที่ยังต่อไม่ได้แทนการซ่อน",
  ],
  side_effects: [
    "none — read-only by construction; ไม่มี writeFileSync/appendFileSync ในโฟลเดอร์นี้เลย และ contract ไม่ export อะไรที่เขียน สั่งงาน หรือตัดสินใจ",
  ],
  dependencies: [
    "software/registry-database (ทะเบียน canonical ที่เป็นแหล่งของ node/edge)",
    "control/runtime-control (นิยามบริการที่ใช้ทำ SERVICE node และ health probe เมื่อ probeServices=true)",
    "transport/owner-command-http (ผู้เรียกจริงเพียงรายเดียวใน production — เสิร์ฟผลที่ GET /graph/system)",
  ],

  behavior:
    "สร้างภาพอ่านอย่างเดียวของโครงสร้างระบบ canonical เพื่อให้ส่วนอื่นถามได้ว่าระบบมีอะไรและเชื่อมกันอย่างไร " +
    "buildSystemGraph() รวมผู้ผลิตที่มีอยู่แล้วให้เป็นกราฟเดียว โดยไม่เพิ่มความรู้ของตัวเองลงไป — " +
    "สิ่งที่ต่อไม่ได้ถูกรายงานใน unresolved[] แทนที่จะถูกเดาให้ครบ ความสามารถนี้ไม่มีเส้นทางไปสู่การลงมือ " +
    "ผู้บริโภคจึงไม่สามารถไปถึงการสั่งงานผ่านมันได้ตามโครงสร้าง",

  evidence_refs: [
    "runtime caller: transport/owner-command-http/server.ts:618 — void import(\"../../software/system-graph/contract\").then(graph => graph.buildSystemGraph({ probeServices }))",
    "runtime endpoint: GET http://127.0.0.1:8791/graph/system -> HTTP 200",
    "live measurement 2026-08-30: nodes=171 edges=481, node kinds DOMAIN 16 / CAPABILITY 142 / SERVICE 9 / PROVIDER 4",
    "response shape measured: counts, edges, generated_at, nodes, sources, unresolved",
    "read-only proof: grep writeFileSync|appendFileSync ใน software/system-graph/*.ts = 0 จุด",
    "public boundary: software/system-graph/contract.ts export เฉพาะ buildSystemGraph และชนิดข้อมูล",
    "consumed by product: dna-os-control-workspace /api/core/graph proxies this endpoint verbatim",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "software/system-graph-projection",
};
