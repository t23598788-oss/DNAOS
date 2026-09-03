/**
 * หน้าที่: แบบจำลองของเส้นทางเดียวที่พิสูจน์แล้วด้วย CHECKPOINT_01..10
 *
 * ความหมายทุกบรรทัดในไฟล์นี้มาจาก **สิ่งที่ Owner ต้องการให้เกิดกับคน**
 * ไม่ได้อ่านจากซอร์ส และ `implementation` ถูกผูกทีหลังในไฟล์แยก เพื่อให้เห็น
 * ชัดว่าความหมายยืนอยู่ได้เองโดยไม่มีโค้ด
 *
 * Input: none
 * Output: `RECOVERY_OUTCOME`, `RECOVERY_FLOW`, `RECOVERY_CONTRACTS`
 * Dependency ที่อนุญาต: ./types.ts
 * สิ่งที่ห้ามแตะ: ห้ามเขียน purpose จากชื่อไฟล์ และห้ามให้ success_condition
 * ของขั้นสุดท้ายเป็น "ตอบ HTTP 200"
 */

import type { BoundaryContract, ExpectedHumanOutcome, FlowStep } from "./types";

/** ประกาศก่อนซอร์ส — ความหมายนี้ไม่ได้มาจากไฟล์ใดเลย */
export const RECOVERY_OUTCOME: ExpectedHumanOutcome = {
  outcome_id: "outcome:owner-requested-operation-result",
  owner_intent: "Owner สั่งให้ระบบทำอะไรบางอย่าง",
  expected_human_outcome:
    "Owner ได้รับผลจริงของสิ่งที่สั่ง และบอกได้เองว่ามันสำเร็จหรือล้มเหลว โดยมีหลักฐานที่ตรวจสอบได้",
  human_success_condition:
    "Owner เห็นผลของคำสั่งของตัวเอง พร้อมตัวชี้หลักฐานที่เปิดดูแล้วพิสูจน์ผลนั้นได้ — " +
    "การที่ระบบตอบ 200 หรือมี task_id ไม่นับ ถ้า Owner ยังไม่ได้ผลที่ใช้งานได้",
  declared_at: "2026-08-30",
  meaning_source: "คำสั่งของ Owner ใน DNA_OS_FULL_SYSTEM_RECOVERY_V1 (ข้อความของคน ไม่ใช่ซอร์ส)",
};

export const RECOVERY_FLOW: readonly FlowStep[] = [
  {
    flow_step_id: "S1_OWNER_COMMAND",
    purpose: "รับสิ่งที่ Owner ต้องการ โดยไม่บังคับให้ Owner พูดภาษาเครื่อง",
    required_input: "เจตนาของ Owner ในรูปที่ Owner ให้มา",
    expected_output: "คำสั่งที่มีตัวตนถาวรและตามรอยกลับหา Owner ได้",
    upstream_step: null, downstream_step: "S2_ADMISSION",
    success_condition: "มี command identity ที่ถูกบันทึกและอ่านกลับได้",
    failure_condition: "คำสั่งหายไปโดยไม่มีร่องรอย หรือถูกแปลจนไม่ตรงเจตนาเดิม",
    evidence_required: ["command_id", "บันทึกถาวรของคำสั่ง"],
  },
  {
    flow_step_id: "S2_ADMISSION",
    purpose: "ตัดสินว่าสิ่งที่ขอเข้าเงื่อนไขที่ระบบยอมรับหรือไม่ ก่อนที่อะไรจะเกิดขึ้น",
    required_input: "คำสั่งที่มีตัวตน + งานที่ประกาศขอบเขตไว้",
    expected_output: "รับเข้า พร้อมเหตุผล หรือปฏิเสธ พร้อมรหัสเหตุผลที่เครื่องอ่านได้",
    upstream_step: "S1_OWNER_COMMAND", downstream_step: "S3_DECISION",
    success_condition: "ผลการรับเข้าเป็นค่าที่มีชนิด พร้อมเหตุผล",
    failure_condition: "ปฏิเสธโดยไม่บอกเหตุผล หรือรับเข้าสิ่งที่เกินขอบเขตที่ประกาศ",
    evidence_required: ["ผลการตรวจ", "รหัสเหตุผล"],
  },
  {
    flow_step_id: "S3_DECISION",
    purpose: "ตัดสินว่าการกระทำนี้ได้รับอนุญาตหรือไม่ พร้อมหลักฐานของกฎที่ใช้ตัดสิน",
    required_input: "งานที่ผ่านการรับเข้า",
    expected_output: "คำตัดสินที่มีตัวตน พร้อมหลักฐานของกฎแต่ละข้อ",
    upstream_step: "S2_ADMISSION", downstream_step: "S4_WORK_ORDER",
    success_condition: "มี decision_id และหลักฐานกฎที่ตรวจได้",
    failure_condition: "อนุญาตโดยไม่มีกฎรองรับ หรือปฏิเสธโดยไม่ระบุกฎ",
    evidence_required: ["decision_id", "หลักฐานรายกฎ"],
  },
  {
    flow_step_id: "S4_WORK_ORDER",
    purpose: "แปลงคำตัดสินเป็นงานที่มีขอบเขตชัดเจนว่าจะแตะอะไรได้บ้าง",
    required_input: "คำตัดสินที่อนุญาต",
    expected_output: "งานที่ระบุขอบเขตการเขียนและเงื่อนไขการตรวจไว้ล่วงหน้า",
    upstream_step: "S3_DECISION", downstream_step: "S5_DISPATCH",
    success_condition: "มี intent_id และขอบเขตที่ประกาศไว้",
    failure_condition: "งานไม่มีขอบเขต หรือขอบเขตกว้างกว่าที่คำตัดสินอนุญาต",
    evidence_required: ["intent_id", "ขอบเขตที่ประกาศ"],
  },
  {
    flow_step_id: "S5_DISPATCH",
    purpose: "ส่งงานให้ผู้ลงมือที่ระบุตัวได้",
    required_input: "งานที่มีขอบเขต",
    expected_output: "การส่งมอบที่บันทึกไว้ พร้อมตัวตนของผู้รับ",
    upstream_step: "S4_WORK_ORDER", downstream_step: "S6_EXECUTION",
    success_condition: "มีบันทึกการส่งมอบที่ระบุผู้รับ",
    failure_condition: "งานถูกส่งโดยไม่รู้ว่าใครรับ หรือไม่ถูกส่งเลยแต่ระบบคิดว่าส่งแล้ว",
    evidence_required: ["handoff", "ตัวตนผู้รับ"],
  },
  {
    flow_step_id: "S6_EXECUTION",
    purpose: "ทำสิ่งที่ถูกสั่งจริง ภายในขอบเขตที่ได้รับอนุญาต",
    required_input: "งานที่ถูกส่งมอบ",
    expected_output: "การเปลี่ยนแปลงจริงที่วัดได้ ภายในขอบเขตเท่านั้น",
    upstream_step: "S5_DISPATCH", downstream_step: "S7_RESULT",
    success_condition: "ผลลัพธ์ที่วัดได้ตรงกับสิ่งที่สั่ง และไม่ออกนอกขอบเขต",
    failure_condition: "ไม่เกิดการเปลี่ยนแปลง หรือเปลี่ยนนอกขอบเขต",
    evidence_required: ["write_id", "ผลที่วัดได้จริง"],
  },
  {
    flow_step_id: "S7_RESULT",
    purpose: "รายงานสิ่งที่เกิดขึ้นจริง ไม่ใช่สิ่งที่ตั้งใจให้เกิด",
    required_input: "ผลของการลงมือ",
    expected_output: "สถานะและผลที่สะท้อนสิ่งที่วัดได้",
    upstream_step: "S6_EXECUTION", downstream_step: "S8_EVIDENCE",
    success_condition: "สถานะตรงกับผลที่วัดได้",
    failure_condition: "รายงานสำเร็จทั้งที่วัดไม่ได้ว่าสำเร็จ",
    evidence_required: ["status", "output ที่วัดได้"],
  },
  {
    flow_step_id: "S8_EVIDENCE",
    purpose: "เก็บหลักฐานให้ตรวจย้อนได้ภายหลังโดยไม่ต้องเชื่อคำบอกเล่า",
    required_input: "ผลที่รายงาน",
    expected_output: "แถวหลักฐานถาวรที่ผูกกับงานนี้",
    upstream_step: "S7_RESULT", downstream_step: "S9_NEXT_DECISION",
    success_condition: "อ่านหลักฐานกลับได้ด้วยตัวตนของงาน",
    failure_condition: "ไม่มีหลักฐาน หรือหลักฐานผูกกับงานอื่น",
    evidence_required: ["evidence_id ที่ผูกกับ task_id"],
  },
  {
    flow_step_id: "S9_NEXT_DECISION",
    purpose: "บอกว่าเรื่องนี้จบแล้วหรือยัง และถ้ายัง ต้องทำอะไรต่อ",
    required_input: "ผลและหลักฐาน",
    expected_output: "สถานะปลายทาง หรือการกระทำถัดไปที่ระบุได้",
    upstream_step: "S8_EVIDENCE", downstream_step: "S10_OWNER_PRESENTATION",
    success_condition: "มีสถานะปลายทางหรือ next_action ที่ชัดเจน",
    failure_condition: "จบลงเฉย ๆ โดยไม่บอกว่าจบหรือค้าง",
    evidence_required: ["สถานะปลายทาง หรือ next_action"],
  },
  {
    flow_step_id: "S10_OWNER_PRESENTATION",
    purpose: "ทำให้ Owner เห็นผลของสิ่งที่ตัวเองสั่ง และตัดสินได้เองว่าสำเร็จไหม",
    required_input: "ผล + หลักฐาน + สถานะ",
    expected_output: "ผลที่ Owner อ่านได้ พร้อมตัวชี้หลักฐานที่เปิดดูได้",
    upstream_step: "S9_NEXT_DECISION", downstream_step: null,
    success_condition:
      "Owner ได้ผลของคำสั่งตัวเอง พร้อมตัวชี้หลักฐาน — ไม่ใช่แค่ระบบตอบ 200",
    failure_condition:
      "ระบบทำงานสำเร็จทางเทคนิค แต่ Owner ไม่ได้ผลที่ใช้งานได้ หรือได้แต่ตรวจสอบไม่ได้",
    evidence_required: ["ผลที่ Owner เข้าถึงได้", "ตัวชี้หลักฐาน"],
  },
];

export const RECOVERY_CONTRACTS: readonly BoundaryContract[] = RECOVERY_FLOW
  .filter((s) => s.downstream_step !== null)
  .map((s) => {
    const next = RECOVERY_FLOW.find((x) => x.flow_step_id === s.downstream_step)!;
    return {
      from_step: s.flow_step_id, to_step: next.flow_step_id,
      contract: `${s.flow_step_id}.output -> ${next.flow_step_id}.input`,
      expected_from_output: s.expected_output,
      expected_to_input: next.required_input,
      input_evidence: [], output_evidence: [],
    };
  });
