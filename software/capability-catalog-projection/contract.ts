/**
 * หน้าที่: ขอบเขตสาธารณะของ `software/capability-catalog-projection/` —
 * ไฟล์เดียวที่โฟลเดอร์อื่นได้รับอนุญาตให้ import ตาม CAPABILITY_FOLDER_LAW ข้อ 9
 *
 * Output: re-exports เท่านั้น
 * Dependency ที่อนุญาต: ./projection.ts, ./types.ts, ./recorded-provenance.ts
 */
export { buildCapabilityCatalog, checkProvenance } from "./projection";
export { RECORDED_CONTRACT_CANDIDATES, RECORDED_PARTIAL } from "./recorded-provenance";
export type { RecordedContractCandidate } from "./recorded-provenance";
export type {
  CapabilityCatalogRow, CapabilityCatalogSummary, ContractEvidenceLevel,
  ContractStatus, ContractProvenance, ProvenanceCheck,
} from "./types";
