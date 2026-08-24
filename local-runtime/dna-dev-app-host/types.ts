/**
 * หน้าที่: type contracts for `local-runtime/dna-dev-app-host/` — the governed
 * source of the DNA DEV desktop application host.
 *
 * DNA DEV.app is the Owner's desktop entrypoint to the DNA OS control UI. The
 * bundle on the Desktop is a GENERATED, INSTALLED ARTIFACT built from this
 * folder — never canonical source, never hand-edited (Owner decision,
 * 2026-08-24, Option 1).
 *
 * Input: none (pure type definitions).
 * Output: `LaunchTarget`, `BuildManifest`, `InstallRecord`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller assert its own artifact
 * hash. A hash is only ever COMPUTED from the real bytes on disk
 * (`./build.sh`, `./install.sh`), never supplied.
 */

/**
 * Where DNA DEV.app points. `runtime_kind` exists so a reader can never mistake
 * a local development URL for the canonical deployed runtime — the Owner's
 * explicit rule was "do not silently fall back to localhost if Railway is the
 * canonical runtime", so the fallback must be visible in the type, not implied.
 */
export interface LaunchTarget {
  /** The canonical deployed runtime this app opens. */
  url: string;
  runtime_kind: "RAILWAY_DEPLOYMENT" | "LOCAL_DEVELOPMENT";
  /** The Railway service name that serves `url`, per .railway/railway.ts. */
  railway_service: string;
  /** Why this target is canonical — carried into the build manifest as evidence. */
  evidence: readonly string[];
}

/** Produced by `./build.sh`. Every field is measured from the real built bundle. */
export interface BuildManifest {
  build_id: string;
  capability_id: string;
  owner_folder: string;
  /** SHA256 of each governed source file that went into the build. */
  source_hashes: Readonly<Record<string, string>>;
  /** SHA256 of the built launcher executable inside the bundle. */
  artifact_launcher_sha256: string;
  /** SHA256 over the whole built bundle's file set, order-stable. */
  artifact_bundle_sha256: string;
  launch_target: LaunchTarget;
  built_at: string;
}

/** Produced by `./install.sh` — proves the installed bytes equal the built bytes. */
export interface InstallRecord {
  install_id: string;
  build_id: string;
  installed_path: string;
  /** Recomputed from the INSTALLED bundle, never copied from the build manifest. */
  desktop_launcher_sha256: string;
  desktop_bundle_sha256: string;
  /** true only when the installed hashes equal the built hashes. */
  provenance_match: boolean;
  installed_at: string;
}
