/**
 * หน้าที่: type contracts for `local-runtime/dna-dev-app-host/`.
 *
 * Input: none (pure type definitions).
 * Output: `LaunchTarget`, `BuildManifest`, `InstallRecord`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller assert its own artifact
 * hash. A hash is only ever COMPUTED from the real bytes on disk.
 */

/**
 * Where DNA DEV.app points. `runtime_kind` is NODE_LOCAL vs REGISTERED_REMOTE
 * (runtime-endpoint-registry source), never a provider placement enum.
 * There is no silent localhost fallback: REGISTERED_REMOTE must be explicit.
 */
export interface LaunchTarget {
  url: string;
  runtime_kind: "REGISTERED_REMOTE" | "NODE_LOCAL";
  /** Existing runtime-control ServiceId — not a provider service id. */
  service_id: string;
  evidence: readonly string[];
}

export interface BuildManifest {
  build_id: string;
  capability_id: string;
  owner_folder: string;
  source_hashes: Readonly<Record<string, string>>;
  artifact_launcher_sha256: string;
  artifact_bundle_sha256: string;
  launch_target: { url: string; runtime_kind: string; service_id?: string };
  icon?: string;
  built_at?: string;
}

export interface InstallRecord {
  installed_at: string;
  destination: string;
  build_id: string;
}
