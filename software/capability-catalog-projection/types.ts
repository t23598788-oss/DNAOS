/**
 * หน้าที่: type ของ Capability Catalog Projection — **read model ที่ derive ล้วน**
 *
 * เอกสารอ้างอิง: governance/architecture-rules/CAPABILITY_CATALOG_PROJECTION_DESIGN.md
 *
 * สามความจริงที่ต้องแยกกันตลอด ห้ามยุบรวม:
 *
 *   CANONICAL_DECLARED_CONTRACT  สิ่งที่ประกาศไว้ตอนลงทะเบียนตัวตน
 *                                (canonical.input_contract / output_contract)
 *   SOURCE_PROVEN_CONTRACT       สิ่งที่ source/type/validator/test พิสูจน์ได้ "ตอนนี้"
 *   PROJECTED_EXECUTABILITY      ผลที่ derive จาก canonical identity + binding
 *                                + SOURCE_PROVEN_CONTRACT
 *
 * ห้ามเรียกข้อมูลที่ projection คำนวณว่าเป็น canonical contract เด็ดขาด
 *
 * Input: none (type ล้วน).
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ที่ทำให้ projection กลายเป็นที่เก็บข้อมูล —
 * ทุกค่าต้องคำนวณสดจากทะเบียนและ source จริงทุกครั้งที่ถูกอ่าน
 */

/** ระดับหลักฐานของ contract ฝั่งใดฝั่งหนึ่ง (input หรือ output) */
export type ContractEvidenceLevel =
  | "PROVEN_VALIDATOR"   // มีตัวตรวจ runtime จาก unknown จริง
  | "PROVEN_TYPE"        // มี TypeScript type ที่ signature ประกาศไว้
  | "PROVEN_BY_TEST"     // มีเทสต์ที่เรียกจริง
  | "PARTIAL"
  | "UNKNOWN";

export type ContractStatus = "DECLARED" | "EMPTY";

/** ทุก field ที่ projection เสนอ ต้องมี provenance ครบชุดนี้ ไม่มีข้อยกเว้น */
export interface ContractProvenance {
  readonly source_location: string;
  readonly symbol: string;
  readonly type_or_schema: string;
  readonly validator: string | null;
  readonly test: string | null;
  readonly evidence_reference: string;
}

export interface ProvenanceCheck {
  readonly ok: boolean;
  /** เหตุผลที่ตรวจไม่ผ่าน — projection ต้อง downgrade ไม่ใช่ปล่อยผ่าน */
  readonly reasons: readonly string[];
}

export interface CapabilityCatalogRow {
  readonly capability_id: string;
  readonly canonical_name: string;

  // ── ตัวตน (จาก canonical เท่านั้น) ──────────────────────────────────
  readonly registered: boolean;
  readonly resolvable: boolean;

  // ── contract สองชุด แยกกันเด็ดขาด ─────────────────────────────────
  readonly canonical_contract_status: ContractStatus;
  readonly canonical_input_contract: readonly string[];
  readonly canonical_output_contract: readonly string[];

  readonly source_proven_contract_status: "COMPLETE" | "PARTIAL" | "NONE";
  readonly source_proven_input: ContractEvidenceLevel;
  readonly source_proven_output: ContractEvidenceLevel;
  readonly source_provenance: readonly ContractProvenance[];
  readonly provenance_check: ProvenanceCheck;

  // ── ผลลัพธ์สามชั้น ห้ามยุบ ────────────────────────────────────────
  readonly canonical_executable: boolean;
  readonly projected_executable: boolean;
  readonly runtime_available: boolean;

  readonly execution_binding_refs: readonly string[];
  readonly invocation_surfaces: readonly string[];
  readonly executable_reason: string;
  readonly availability_reason: string;
}

export interface CapabilityCatalogSummary {
  readonly registered: number;
  readonly resolvable: number;
  readonly canonical_executable: number;
  readonly projected_executable: number;
  /** source-proven OR canonical-declared — เส้นเดียวกับที่ Owner ถามว่า "อะไรเรียกใช้ได้" */
  readonly executable_union: number;
  readonly runtime_available: number;
  readonly projected_complete: number;
  readonly projected_partial: number;
  readonly provenance_failures: number;
  /** capability ที่มี invocation surface ซึ่งยังไม่มี contract บันทึกไว้ */
  readonly surfaces_without_contract: number;
  readonly computed_at: string;
}
