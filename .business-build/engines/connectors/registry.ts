/**
 * Connect Core — Contract Registry.
 *
 * The ONE place a provider identifier is listed. Central routes, gateways and
 * UI look a contract up here by id (`findContract(providerId)`) instead of any
 * branch on a provider name — the same single-array pattern the real
 * WORKER_ADAPTER_REGISTRY already uses
 * (app/api/admin/ide/_lib/workerSelectorRuntime.ts:20).
 *
 * Deliberately import-free beyond the contracts themselves: this module must
 * stay usable from any allowed layer (no engines -> gateway edge — see
 * registry/dependency-graph.json allowed_imports.engines). Runtime wiring
 * (connector summary + the canonical Test call) is injected by the caller's own
 * layer, per ConnectRuntimeDeps in ./contract.ts.
 */
import type { ConnectContract } from "./contract";
import { railwayConnectContract } from "./providers/railway";
import { githubConnectContract } from "./providers/github";
import { lineConnectContract } from "./providers/line";

/** Every provider that implements the Connect contract, regardless of state.
 *  Adding a provider means adding its adapter above and its name here — nothing
 *  else in the codebase changes (proved by the second provider, github:
 *  engines/connectors/providers/github.ts — and re-proved by the third, line,
 *  which needed no central route/gateway/catalog/UI edit either). */
export const CONNECT_CONTRACTS: readonly ConnectContract[] = [railwayConnectContract, githubConnectContract, lineConnectContract];

/** Contract lookup by canonical provider id — never by display name. */
export function findContract(providerId: string): ConnectContract | undefined {
  const id = providerId.trim().toLowerCase();
  if (!id) return undefined;
  return CONNECT_CONTRACTS.find((c) => c.providerId === id);
}

/** Declared provider ids, sorted — for honest "what is pluggable" reporting. */
export function listConnectContractIds(): string[] {
  return CONNECT_CONTRACTS.map((c) => c.providerId).sort();
}
