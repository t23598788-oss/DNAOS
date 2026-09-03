/**
 * หน้าที่: candidate ของ `control/machine-model/` — ซอฟต์แวร์จริงที่รันอยู่แล้ว
 *          แต่ยังไม่มีตัวตนในทะเบียน
 *
 * ── หลักฐานที่ทำให้อ้างได้ ไม่ใช่คำอธิบาย ──
 * พฤติกรรมของมันถูกพิสูจน์ด้วยการรันจริงซ้ำ ไม่ใช่ด้วยการอ่านซอร์สแล้วตั้งชื่อให้:
 *   107 เทสต์ในไฟล์เดียวของโฟลเดอร์นี้ผ่านทั้งหมด (0 ล้ม) รันจริงบนเครื่องนี้
 *   `buildMachineModel()` คืนโหนด 3,475 เส้น 2,849 จากทะเบียนที่มีอยู่ 14 แหล่ง
 *   `classifyExecutions()` จำแนกการลงมือจริง 21,997 ครั้ง ผลรวมตรงกับที่วัดได้พอดี
 *   เรียกซ้ำในโปรเซสเดียวให้ผลเท่ากันแบบ byte (เทสต์ 14/19)
 *
 * ── อ่านอย่างเดียว พิสูจน์ด้วยการวัด ไม่ใช่ด้วยคำสัญญา ──
 * เทสต์ 13/23/33/44/53/62/71/78/87/97/107 ตรวจซอร์สของทุกไฟล์ในโฟลเดอร์ว่าไม่มี
 * `writeFileSync`/`appendFileSync`/`mkdirSync`/`dispatchRoute`/`submitTask`/`spawn`
 * และวัดขนาดคลังจริงก่อน-หลังการเรียก ว่าไม่ขยับ
 *
 * `source_location` เป็น repo-relative โดยเจตนา — ตัวตนของซอฟต์แวร์ต้องไม่ขึ้นกับ
 * ว่าใครเช็คเอาต์ไว้ที่ไหน
 *
 * Input: none (ค่าคงที่ค่าเดียว)
 * Output: `MACHINE_MODEL_CANDIDATE`
 * Dependency ที่อนุญาต: type-only จาก control/event-pipeline/registration-contract.ts
 * สิ่งที่ห้ามแตะ: ห้ามแก้ `evidence_refs` ให้อ้างการรันที่ไม่ได้เกิดขึ้นจริง
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const MACHINE_MODEL_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-machine-model-v1",
  name: "machine-model",
  kind: "capability",
  source_location: "control/machine-model/",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/machine-model.ts",
  version: "1.0.0",

  input: [
    "none — ประกอบจากคลังที่ถูกเขียนไว้แล้วเท่านั้น ไม่รับพารามิเตอร์ที่เปลี่ยนความจริง",
    "BuildOptions.census?: boolean — ปิดการสำรวจร่างกายเครื่องได้ ค่าเริ่มต้นคือเปิด",
    "BuildOptions.invocation?: boolean — ปิดการฉายความสัมพันธ์การเรียกใช้ได้ ใช้เทียบก่อน/หลังในโปรเซสเดียว",
  ],
  output: [
    "MachineModel: nodes[] 17 ชั้น, edges[], coverage[], machine_id, built_from[] — วัดได้ 3,475 โหนด 2,849 เส้น",
    "DependencyIndex: dependenciesOf/dependentsOf/impactOf — ตอบสองทิศจากเส้นที่ประกาศความหมายแล้ว 2,788 เส้น",
    "SelfTool[]/CapabilityKnowledge[]: เมทริกซ์ความรู้ 112x15 ช่อง แต่ละช่องเป็น KNOWN/MISSING/NOT_APPLICABLE",
    "ClassificationResult: การลงมือทุกครั้งถูกจัดหนึ่งบริบท ผลรวมเท่ากับจำนวนที่วัดได้พอดี",
    "EquationResult: ตัวแก้สมการตัวเดียวสำหรับทุกผลลัพธ์ ไม่มีสูตรสำเร็จรายผลลัพธ์",
  ],
  side_effects: [
    "none — read-only by construction; ทุกไฟล์ในโฟลเดอร์ไม่มีคำสั่งเขียนไฟล์ และเทสต์วัดขนาดคลังก่อน-หลังว่าไม่เปลี่ยน",
    "อ่านสถานะเครื่องผ่านคำสั่งอ่านของ OS (sysctl/uname/sw_vers/df/launchctl list/lsof) ซึ่งไม่เปลี่ยนสถานะใด",
  ],
  dependencies: [
    "software/registry-database/ — ทะเบียน canonical (resources, capabilities, relationships, resource_capabilities)",
    "software/repository-registry/ — ตัวตนของรีโป",
    "control/machine-observation/ — observations, runtime-targets",
    "control/agent-gateway/ — evidence, tasks, handoffs",
    "control/owner-command/ — envelopes (สายอำนาจของ Owner)",
    "execution/installation-initialization/ — ตัวตนของเครื่อง",
    "connections/telemetry/, connections/connection-registry/, credentials/registry/ — ตัวชี้เท่านั้น",
  ],
  behavior: "compose_canonical_machine_model_and_answer_self_knowledge_queries_read_only",
  evidence_refs: [
    "control/machine-model/tests/machine-model.test.ts — 107 passed, 0 failed (รันจริงบนเครื่องนี้)",
    "buildMachineModel() -> nodes=3475 edges=2849 coverage=17/17 layers REPRESENTED",
    "classifyExecutions() -> total=21997, ผลรวมของหกบริบทเท่ากับ total พอดี",
    "machine_id=installation-e82ee9af-48f3-4185-9bf3-4714f7cf78f4 อ่านกลับได้ข้ามโปรเซส",
    "เทสต์ 13/33/44/53/62/71/78/87/97/107 วัดขนาดคลังจริงก่อน-หลัง: ไม่เปลี่ยน",
  ],
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "control/machine-model",
  // ── ไม่อ้างสิทธิ์รีโป ──
  // ทะเบียนรีโปยังไม่มีแถวของ DNA-OS-INFRASTRUCTURE เอง การอ้างชื่อที่ยังไม่มีตัวตน
  // จะเป็นการอ้างสิทธิ์ที่พิสูจน์ไม่ได้ ทั้งสองช่องจึงเว้นไว้ (NOT_APPLICABLE ที่ถูกต้อง
  // ตามสัญญา) เหมือน candidate ที่ลงทะเบียนสำเร็จมาก่อนหน้านี้
};
