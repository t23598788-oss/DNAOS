/**
 * หน้าที่: the public boundary of `control/service-reload/` — the only file
 * another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * This capability is a CONNECTION, not an authority: it resolves which
 * registered service a changed source path belongs to, gates the change, and
 * asks `../runtime-control/` to act. It never calls launchctl, kill or spawn.
 *
 * Input: re-exports only.
 * Output: `requestReload`, `resolveServiceImpact`, `computeSourceRevision`,
 * `serviceSourceRoot`, `runReloadGate`, `reloadRequiredFor` (read-only),
 * plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { requestReload, reloadForVerifiedCommit, reloadRequiredFor, resolveServiceImpact, computeSourceRevision, serviceSourceRoot, runReloadGate } from "./resolver";
export type { ReloadRequest } from "./resolver";
export type {
  ServiceImpact, SourceRevision, ReloadGate, GateStatus,
  RevisionProof, ReloadDecision, ReloadOutcome, GateAuthority, ReloadTrigger,
} from "./types";
