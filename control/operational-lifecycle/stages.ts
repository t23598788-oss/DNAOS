/**
 * หน้าที่: สารบัญเดียวของขั้นปฏิบัติการ — ลำดับ ความสัมพันธ์ และเงื่อนไขจบของ
 * 14 operational entries. The architecture folder has additional
 * governance companions, STRUCTURE_LOCK_MAP.md and
 * RUNTIME_NODE_AND_OPTIONAL_PROVIDER.md, which are indexed but are not
 * extra lifecycle steps.
 *
 * นี่คือ metadata ที่ *เพิ่มเข้าไป* กับเอกสารเดิม ไม่ใช่เอกสารชุดที่สอง —
 * `document_id` ชี้กลับไปที่ไฟล์ .md ตัวจริงเสมอ และเนื้อหายังอ่านจากที่เดิม
 * ถ้าลบไฟล์นี้ทิ้ง เอกสารทั้ง 14 ยังอยู่ครบ สิ่งที่หายคือลำดับ
 *
 * ลำดับมาจากลำดับของงานจริง ไม่ใช่ตัวอักษร: กฎมาก่อนการสำรวจ การสำรวจมาก่อน
 * การให้ตัวตน ตัวตนมาก่อนทะเบียน ทะเบียนมาก่อนสัญญาการเชื่อมต่อ และการ deploy
 * มาหลังสุดเสมอ ลำดับตัวอักษรทำให้ VERCEL_BOUNDARY_PLAN (ขั้นสุดท้าย) มาอยู่
 * ท้ายพอดีโดยบังเอิญ แต่ทำให้ ACCOUNTING (งานคู่ขนาน) ขึ้นเป็นอันดับหนึ่ง
 *
 * `parallel_group` ต้องประกาศเสมอเมื่อจะขนาน — ไม่มีการขนานโดยปริยาย
 *
 * Input: none (การประกาศล้วน).
 * Output: `STAGES`, `stageById`, `stagesInOrder`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามใส่สถานะลงในไฟล์นี้, ห้ามสร้างเอกสารใหม่มาแทนที่เอกสารเดิม,
 * ห้ามให้ลำดับซ้ำกัน.
 */

import type { LifecycleStageDeclaration } from "./types";

const DIR = "governance/architecture-rules";

/**
 * 14 ขั้น operational; the companion document is deliberately not a step.
 *
 * ขั้น 01 เป็นดัชนีของโฟลเดอร์ ไม่ใช่ขั้นของงาน จึงไม่มีใครขึ้นกับมันและมันไม่กันใคร
 * แต่ยังนับเป็นหนึ่งรายการ เพราะเจ้าของเห็นมันอยู่บนหน้าจอจริง
 */
export const STAGES: readonly LifecycleStageDeclaration[] = [
  {
    stage_id: "architecture-rules-index", sequence: 1,
    title: "ดัชนีกฎสถาปัตยกรรม", stage_kind: "REFERENCE",
    document_id: "README.md", source_location: `${DIR}/README.md`,
    depends_on_stage_ids: [], parallel_group: "reference",
    entry_condition: "โฟลเดอร์กฎสถาปัตยกรรมมีอยู่",
    completion_condition_ids: ["ARCHITECTURE_RULES_INDEX_LISTS_EVERY_DOCUMENT"],
    verification_requirement: "ดัชนีต้องอ้างถึงเอกสารทุกฉบับที่อยู่จริงในโฟลเดอร์",
  },
  {
    stage_id: "capability-folder-law", sequence: 2,
    title: "กฎโฟลเดอร์ความสามารถ", stage_kind: "GOVERNING_LAW",
    document_id: "CAPABILITY_FOLDER_LAW.md", source_location: `${DIR}/CAPABILITY_FOLDER_LAW.md`,
    depends_on_stage_ids: [], parallel_group: null,
    entry_condition: "ไม่มี — เป็นกฎตั้งต้นของทุกขั้นที่เหลือ",
    completion_condition_ids: ["CAPABILITY_FOLDER_LAW_ENFORCED_BY_RUNNABLE_CHECK"],
    verification_requirement: "ต้องมีด่านที่รันได้และล้มเมื่อมีการละเมิด ไม่ใช่ข้อความที่ประกาศว่า LOCKED",
  },
  {
    stage_id: "connection-census", sequence: 3,
    title: "สำมะโนการเชื่อมต่อของระบบ", stage_kind: "DISCOVERY",
    document_id: "SYSTEM_CONNECTION_CENSUS_PHASE1.md", source_location: `${DIR}/SYSTEM_CONNECTION_CENSUS_PHASE1.md`,
    depends_on_stage_ids: ["capability-folder-law"], parallel_group: null,
    entry_condition: "กฎโฟลเดอร์ถูกประกาศแล้ว จึงรู้ว่าอะไรนับเป็นหนึ่งหน่วย",
    completion_condition_ids: ["CONNECTION_CENSUS_HAS_UI_SURFACE_ENTITY", "ALL_VERSIONS_HAVE_COMMIT_SHA"],
    verification_requirement: "สำมะโนต้องครอบคลุมทุกชนิด entity ที่เจ้าของเห็นได้จริง รวม UI_SURFACE",
  },
  {
    stage_id: "target-identity-discovery", sequence: 4,
    title: "ค้นหาตัวตนของระบบเป้าหมาย", stage_kind: "DISCOVERY",
    document_id: "CANONICAL_TARGET_IDENTITY_DISCOVERY.md", source_location: `${DIR}/CANONICAL_TARGET_IDENTITY_DISCOVERY.md`,
    depends_on_stage_ids: ["connection-census"], parallel_group: null,
    entry_condition: "รู้แล้วว่ามีระบบใดอยู่บ้าง",
    completion_condition_ids: ["TARGET_IDENTITY_NATURAL_KEYS_DECLARED"],
    verification_requirement: "ทุกระบบที่พบต้องมี natural key ที่ประกาศแล้ว ไม่ใช่ค้างเป็น 'ยังไม่มี'",
  },
  {
    stage_id: "capability-repository-lineage", sequence: 5,
    title: "สายเลือดความสามารถถึงรีโป", stage_kind: "DISCOVERY",
    document_id: "CAPABILITY_REPOSITORY_LINEAGE_TRACE.md", source_location: `${DIR}/CAPABILITY_REPOSITORY_LINEAGE_TRACE.md`,
    depends_on_stage_ids: ["capability-folder-law"], parallel_group: "identity-tracks",
    entry_condition: "กฎโฟลเดอร์ระบุขอบเขตของหนึ่งความสามารถแล้ว",
    completion_condition_ids: ["ALL_RESOURCES_HAVE_REPOSITORY_ID", "CAPABILITY_REGISTRY_HAS_LINKS"],
    verification_requirement: "ทุกทรัพยากรต้องชี้กลับไปที่รีโปได้ ไม่มี repository_id = null เหลืออยู่",
  },
  {
    stage_id: "cross-system-instance-registry", sequence: 6,
    title: "ทะเบียนอินสแตนซ์ข้ามระบบ", stage_kind: "DESIGN",
    document_id: "CROSS_SYSTEM_INSTANCE_REGISTRY_DESIGN.md", source_location: `${DIR}/CROSS_SYSTEM_INSTANCE_REGISTRY_DESIGN.md`,
    depends_on_stage_ids: ["target-identity-discovery", "capability-repository-lineage"], parallel_group: null,
    entry_condition: "ตัวตนของทั้งระบบเป้าหมายและของซอร์สถูกระบุแล้ว",
    completion_condition_ids: ["INFRA_REPOSITORY_IDENTITY_REGISTERED", "ALL_RESOURCES_HAVE_REPOSITORY_ID"],
    verification_requirement: "ตัวตนของรีโปหลักต้องอยู่ในทะเบียนและถูกอ้างถึงจากทรัพยากรทุกตัว",
  },
  {
    stage_id: "provider-project-identity", sequence: 7,
    title: "ลงทะเบียนตัวตนโครงการฝั่งผู้ให้บริการ", stage_kind: "DESIGN",
    document_id: "PROVIDER_PROJECT_IDENTITY_REGISTRATION.md", source_location: `${DIR}/PROVIDER_PROJECT_IDENTITY_REGISTRATION.md`,
    depends_on_stage_ids: ["cross-system-instance-registry"], parallel_group: null,
    entry_condition: "ทะเบียนอินสแตนซ์รับตัวตนข้ามระบบได้แล้ว",
    completion_condition_ids: ["PROVIDER_PROJECT_IDENTITY_HAS_EXECUTOR_SOURCE"],
    verification_requirement: "ทุก declaration ต้องมีผู้ลงมือจริง ไม่มี executor_source = NONE เหลืออยู่",
  },
  {
    stage_id: "connection-contract", sequence: 8,
    title: "สัญญาการเชื่อมต่อ เฟส A", stage_kind: "DESIGN",
    document_id: "CONNECTION_CONTRACT_PHASE_A.md", source_location: `${DIR}/CONNECTION_CONTRACT_PHASE_A.md`,
    depends_on_stage_ids: ["provider-project-identity"], parallel_group: null,
    entry_condition: "ตัวตนโครงการฝั่งผู้ให้บริการถูกลงทะเบียนแล้ว",
    completion_condition_ids: ["CONNECTION_DECLARATIONS_HAVE_IO_CONTRACT"],
    verification_requirement: "ทุก connection ต้องประกาศ input และ output contract ไม่มีช่องว่าง",
  },
  {
    stage_id: "semantic-contract-discovery", sequence: 9,
    title: "ค้นหาความหมายและสัญญาของความสามารถ", stage_kind: "DISCOVERY",
    document_id: "SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY.md", source_location: `${DIR}/SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY.md`,
    depends_on_stage_ids: ["capability-repository-lineage"], parallel_group: "catalog-track",
    entry_condition: "ความสามารถถูกผูกกับซอร์สแล้ว จึงมีสิ่งให้ค้นความหมาย",
    completion_condition_ids: ["SEMANTIC_CONTRACT_DISCOVERY_REGISTERED"],
    verification_requirement: "contract ที่ค้นพบต้องถูกลงทะเบียน ไม่จบที่รายงาน",
  },
  {
    stage_id: "capability-catalog-dry-run", sequence: 10,
    title: "ทดลองสารบัญความสามารถ", stage_kind: "DESIGN",
    document_id: "CANONICAL_CAPABILITY_CATALOG_DRY_RUN.md", source_location: `${DIR}/CANONICAL_CAPABILITY_CATALOG_DRY_RUN.md`,
    depends_on_stage_ids: ["semantic-contract-discovery"], parallel_group: "catalog-track",
    entry_condition: "ความหมายของความสามารถถูกค้นแล้ว",
    completion_condition_ids: ["CAPABILITY_REGISTRY_HAS_LINKS", "SEMANTIC_CONTRACT_DISCOVERY_REGISTERED"],
    verification_requirement: "สารบัญต้องตอบได้ทั้งการลงทะเบียนและสภาพจริง โดยไม่ปนสองความหมาย",
  },
  {
    stage_id: "capability-catalog-projection", sequence: 11,
    title: "ฉายภาพสารบัญความสามารถ", stage_kind: "DESIGN",
    document_id: "CAPABILITY_CATALOG_PROJECTION_DESIGN.md", source_location: `${DIR}/CAPABILITY_CATALOG_PROJECTION_DESIGN.md`,
    depends_on_stage_ids: ["capability-catalog-dry-run"], parallel_group: null,
    entry_condition: "การทดลองสารบัญชี้ได้แล้วว่าฟิลด์ใดปนความหมาย",
    completion_condition_ids: ["CATALOG_PROJECTION_HEALTH_IS_MEASURED"],
    verification_requirement: "health_status ต้องมาจาก probe จริง ไม่เหลือ literal ที่พิมพ์มือ",
  },
  {
    stage_id: "operational-lifecycle-model", sequence: 12,
    title: "แบบจำลองวงจรปฏิบัติการ", stage_kind: "DESIGN",
    document_id: "OPERATIONAL_LIFECYCLE_MODEL.md", source_location: `${DIR}/OPERATIONAL_LIFECYCLE_MODEL.md`,
    depends_on_stage_ids: ["cross-system-instance-registry", "capability-repository-lineage"], parallel_group: null,
    entry_condition: "ทะเบียนและสายเลือดพร้อม จึงมีโหนดและเส้นให้ใส่ความหมาย",
    completion_condition_ids: ["FLOW_CONTRACT_STATE_IS_PROVEN_NOT_DECLARED", "REGISTRY_HAS_RUNTIME_RELATION"],
    verification_requirement: "ทุกความสัมพันธ์ต้องไปถึง PROVEN จากการรันจริง ไม่ค้างที่ DECLARED",
  },
  {
    stage_id: "accounting-canonical-truth", sequence: 13,
    title: "ความจริงทางบัญชีหนึ่งเดียว", stage_kind: "DESIGN",
    document_id: "ACCOUNTING_CANONICAL_TRUTH.md", source_location: `${DIR}/ACCOUNTING_CANONICAL_TRUTH.md`,
    depends_on_stage_ids: ["capability-folder-law"], parallel_group: "business-domain",
    entry_condition: "กฎโฟลเดอร์พร้อม — เรื่องนี้เป็นโดเมนธุรกิจ ไม่ขึ้นกับสายทะเบียนเทคนิค",
    completion_condition_ids: ["ACCOUNTING_TRUTH_DERIVED_FROM_LEDGER"],
    verification_requirement: "สถานะการชำระต้องอนุมานจาก ledger ทุกครั้ง ไม่อ่านจากคอลัมน์สถานะเดิม",
  },
  {
    stage_id: "vercel-boundary", sequence: 14,
    title: "ขอบเขตการนำขึ้นระบบจริง", stage_kind: "DESIGN",
    document_id: "VERCEL_BOUNDARY_PLAN.md", source_location: `${DIR}/VERCEL_BOUNDARY_PLAN.md`,
    depends_on_stage_ids: ["connection-contract", "operational-lifecycle-model"], parallel_group: null,
    entry_condition: "สัญญาการเชื่อมต่อและแบบจำลองการไหลพร้อม จึงรู้ว่าอะไรถูกนำขึ้นและด้วยสิทธิ์ใด",
    completion_condition_ids: ["VERCEL_BOUNDARY_CAPABILITY_BUILT", "REGISTRY_HAS_DEPLOYMENT_NODE"],
    verification_requirement: "ต้องมี capability จริงที่ลงทะเบียนแล้ว และมี node ปลายทางในทะเบียน",
  },
];

const BY_ID = new Map(STAGES.map((s) => [s.stage_id, s]));

export function stageById(stageId: string): LifecycleStageDeclaration | null {
  return BY_ID.get(stageId) ?? null;
}

/** เรียงตาม sequence เสมอ — ผู้เรียกไม่ต้องเรียงเอง และเรียงเองไม่ได้ */
export function stagesInOrder(): readonly LifecycleStageDeclaration[] {
  return [...STAGES].sort((a, b) => a.sequence - b.sequence);
}
