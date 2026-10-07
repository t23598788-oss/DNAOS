/**
 * หน้าที่: the public boundary of `execution/process-lock/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `acquireLock`, `releaseLock`, `renewLock`, plus every type a
 * caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { acquireLock, releaseLock, renewLock } from "./resolver";
export type { LockClaim, AcquireLockInput, AcquireLockResult, AcquireLockStatus, ReleaseLockResult, ReleaseLockStatus } from "./types";
