/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of `execution/run/`. `executor.ts` (process
 * lifecycle), `registry.ts` (allowlist), `result.ts` (sanitization/status
 * mapping), `audit.ts` (audit event shape/sink), and `host-runtime.ts`
 * (Node ambient declarations) are private implementation. Mirrors this
 * repo's existing pattern of one contract file per capability (see e.g.
 * `../../connections/github/adapter-contract.ts`,
 * `../../permissions/execution-policy/contract.ts`).
 *
 * HARD BLOCK (Owner, 2026-08-16): no file under `../../control/`, and no
 * `route.ts` anywhere in this repo, imports from this file yet. Wiring
 * either is explicitly out of scope for this round — see
 * `../../reports/EXECUTION_CORE_PORT_REPORT.md` §RUNTIME_ENTRYPOINT.
 *
 * Input: re-exports only.
 * Output: `startExecution`, `getExecution`, `listExecutions`,
 * `cancelExecution`, `subscribeToExecutionEvents`, `listCommandDescriptors`,
 * `getCommandDescriptor`, `projectCommandPolicyDescriptor`,
 * `listCommandPolicyDescriptors`, `WORKSPACE_ROOT_CWD_SCOPE`, plus every
 * type a caller needs to build a request or read a result/event.
 * Dependency ที่อนุญาต: ./executor.ts, ./registry.ts, ./policy-descriptor.ts,
 * ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export anything from ./result.ts,
 * ./audit.ts's sink internals, or ./host-runtime.ts here — those stay
 * private so the sanitization/audit/process mechanics can change without
 * breaking callers.
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./tests/executor.test.ts.
 */

export { startExecution, getExecution, listExecutions, cancelExecution, subscribeToExecutionEvents } from "./executor";
export { listCommandDescriptors, getCommandDescriptor, WORKSPACE_ROOT_CWD_SCOPE } from "./registry";
export { projectCommandPolicyDescriptor, listCommandPolicyDescriptors } from "./policy-descriptor";
export { ExecutionError } from "./types";
export type { ExecutionAuditEvent } from "./audit";
export type { CommandDescriptor, DynamicArgSpec, ExecutionErrorCode, ExecutionEvent, ExecutionEventType, ExecutionRequest, ExecutionResult, ExecutionStatus } from "./types";
// Owner, "Single Process Creation Gate — Consolidation" (2026-08-24): the
// prior "HARD BLOCK: no runtime caller yet" note above is stale — this
// contract now has real internal callers (control/agent-gateway/adapters/
// file-intelligence-adapter.ts, dna-os-circuit/runtime/server.ts,
// credentials/macos-keychain/*.ts, connections/agent-registry/
// codex-session-bridge.ts) via requestProcessExecution below.
export { requestProcessExecution } from "./process-gate";
export type { ProcessRequest, ProcessResult, ProcessResultStatus } from "./process-gate";
export { PROCESS_REGISTRY, resolveProcessDescriptor, NPM_CLI_JS_PATH } from "./process-registry";
export type { ProcessDescriptor, ProcessResolution, NetworkProfile, CredentialProfile } from "./process-registry";
