/**
 * หน้าที่: the type contracts for Repository/File Discovery — read-only
 * inventory of what actually exists on disk in the canonical repo. Never
 * a capability classification, never a registration — see ./README.md.
 *
 * Input: none (pure type definitions).
 * Output: `FileKind`, `DiscoveryRecord`, `DuplicateGroup`,
 * `DiscoveryInventory`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that stores file content — this is a
 * read model of metadata only.
 */

export type FileKind =
  | "SOURCE_CODE"
  | "TEST"
  | "MIGRATION"
  | "CONFIG"
  | "DOCUMENTATION"
  | "DATA"
  | "RUNTIME_DATA"
  | "GENERATED"
  | "TEMP"
  | "UNKNOWN";

export interface DiscoveryRecord {
  discovery_id: string;
  relative_path: string;
  file_name: string;
  extension: string;
  size_bytes: number;
  content_hash: string;
  detected_file_kind: FileKind;
  is_source: boolean;
  is_test: boolean;
  is_documentation: boolean;
  is_migration: boolean;
  is_runtime_data: boolean;
  is_generated: boolean;
  is_temp: boolean;
  is_hidden: boolean;
  discovered_at: string;
}

export interface DuplicateGroup {
  key: string;
  relative_paths: readonly string[];
}

export type FileKindTotals = Readonly<Record<FileKind, number>>;

export interface DiscoveryInventory {
  repo_root: string;
  scanned_at: string;
  excluded_directories: readonly string[];
  total_files_discovered: number;
  totals_by_kind: FileKindTotals;
  duplicate_content_hash_groups: readonly DuplicateGroup[];
  duplicate_file_name_groups: readonly DuplicateGroup[];
  records: readonly DiscoveryRecord[];
}
