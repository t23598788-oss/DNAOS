/**
 * หน้าที่: the public boundary of `local-runtime/dna-dev-app-host/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the launch target declaration + every type a caller needs.
 * Dependency ที่อนุญาต: ./config.ts, ./types.ts.
 */

export { CANONICAL_TARGET, LOCAL_TARGET, resolveLaunchTarget } from "./config";
export type { LaunchTarget, BuildManifest, InstallRecord } from "./types";
