/**
 * หน้าที่: the ONE real list of Workers `submitTask`/`ownerDecision` may
 * dispatch to. Before this file existed, `control/command-router/router.ts`
 * and `dna-os-circuit/runtime/server.ts` each declared their OWN separate
 * array of the same adapters — two independent entry points into the same
 * `submitTask` with two DIFFERENT worker lists (the circuit server's list
 * was missing `aiWriteAdapter`), which is exactly the "duplicate wiring,
 * not one circuit" failure mode the Owner's 2026-08-20 Work Order named.
 * Both callers now import this single constant instead of re-declaring
 * it — one Worker registration, not two that can drift out of sync.
 *
 * Input: none (module-level constant).
 * Output: `DEFAULT_AGENT_WORKERS`.
 * Dependency ที่อนุญาต: ./types.ts, ./adapters/*.
 * สิ่งที่ห้ามแตะ: never let a caller declare its own separate worker array
 * for the same gateway again — add a new Worker here, once, and both
 * `control/command-router/router.ts` and `dna-os-circuit/runtime/server.ts`
 * pick it up automatically. A future Coding Agent worker is added to THIS
 * array, never to a caller-local copy.
 */
import type { AgentAdapter } from "./types";
import { fileIntelligenceAdapter } from "./adapters/file-intelligence-adapter";
import { externalProviderAdapter } from "./adapters/external-provider-adapter";
import { aiWriteAdapter } from "./adapters/ai-write-adapter";

export const DEFAULT_AGENT_WORKERS: readonly AgentAdapter[] = [fileIntelligenceAdapter, externalProviderAdapter, aiWriteAdapter];
