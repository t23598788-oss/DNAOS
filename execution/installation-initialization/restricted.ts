/**
 * Restricted composition surface for canonical initialization creation.
 *
 * This is intentionally separate from `contract.ts`, which exposes only read
 * resolution. TypeScript module visibility is not an unforgeable capability;
 * the V1 boundary is architectural containment and narrow exports. The
 * ceremony must be the only production composition that imports this module.
 */

export { createInstallationInitializationFromCeremony } from "./store";
export type { CreateOutcome, StoreReasonCode } from "./types";
