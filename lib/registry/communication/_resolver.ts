/**
 * DNA OS Communication Registry — Resolver
 * Generic resolution API — use these functions instead of importing JSON directly.
 * All consumers must go through the Registry, never access JSON files directly.
 */

import { load } from "./_loader";
import type {
  CommunicationRegistry,
  CommunicationCapabilities,
  HealthStatus,
  RuntimePolicy,
  SecurityContract,
  DependencyGraph,
  Topology,
} from "./_schema";

// ─── Core Resolver ───────────────────────────────────────────────────────────

/**
 * Resolve a full channel registry by name.
 * Returns null if channel is not registered.
 */
export function resolveCommunication(channel: string): CommunicationRegistry | null {
  return load(channel);
}

/** Alias for resolveCommunication */
export function getCommunicationRegistry(channel: string): CommunicationRegistry | null {
  return resolveCommunication(channel);
}

// ─── Capability ──────────────────────────────────────────────────────────────

/**
 * Returns true only if the capability is explicitly enabled AND status === "ACTIVE".
 */
export function resolveCapability(channel: string, capability: string): boolean {
  const registry = load(channel);
  if (!registry) return false;
  const cap = (registry.capabilities as CommunicationCapabilities)[capability];
  if (!cap) return false;
  return cap.enabled === true && cap.status === "ACTIVE";
}

/**
 * Returns the full capabilities object for a channel.
 */
export function getCommunicationCapabilities(channel: string): CommunicationCapabilities | null {
  return load(channel)?.capabilities ?? null;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Returns the lifecycle map for a channel.
 */
export function resolveLifecycle(channel: string): Record<string, string> | null {
  return load(channel)?.lifecycle ?? null;
}

/** Alias for resolveLifecycle */
export function getCommunicationLifecycle(channel: string): Record<string, string> | null {
  return resolveLifecycle(channel);
}

/**
 * Returns true if lifecycle[feature] === "ACTIVE".
 * Keys starting with "_" are metadata, not lifecycle values.
 */
export function isFeatureEnabled(channel: string, feature: string): boolean {
  const lifecycle = resolveLifecycle(channel);
  if (!lifecycle) return false;
  return lifecycle[feature] === "ACTIVE";
}

// ─── Topology ────────────────────────────────────────────────────────────────

/**
 * Returns the topology object for a channel.
 */
export function resolveTopology(channel: string): Topology | null {
  return load(channel)?.topology ?? null;
}

/** Alias for resolveTopology */
export function getCommunicationTopology(channel: string): Topology | null {
  return resolveTopology(channel);
}

// ─── Policy ──────────────────────────────────────────────────────────────────

/**
 * Returns the full RuntimePolicy for a channel.
 */
export function resolvePolicy(channel: string): RuntimePolicy | null {
  return load(channel)?.policy ?? null;
}

/**
 * Returns true if the specified policy flag is true.
 */
export function isPolicyAllowed(channel: string, policyKey: keyof RuntimePolicy): boolean {
  const policy = resolvePolicy(channel);
  if (!policy) return false;
  return policy[policyKey] === true;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Returns the pipeline steps object for a channel.
 */
export function resolvePipeline(channel: string): Record<string, unknown> | null {
  return load(channel)?.pipeline ?? null;
}

// ─── Health ──────────────────────────────────────────────────────────────────

/**
 * Returns the health status for a channel. Returns "UNKNOWN" if not found.
 */
export function resolveHealth(channel: string): HealthStatus {
  return (load(channel)?.health.status as HealthStatus) ?? "UNKNOWN";
}

// ─── Security ────────────────────────────────────────────────────────────────

/**
 * Returns the security contract for a channel.
 */
export function resolveSecurityContract(channel: string): SecurityContract | null {
  return load(channel)?.security ?? null;
}

// ─── Dependencies ────────────────────────────────────────────────────────────

/**
 * Returns the dependency graph for a channel.
 */
export function resolveDependencies(channel: string): DependencyGraph | null {
  return load(channel)?.depends_on ?? null;
}

// ─── Channel Credentials ─────────────────────────────────────────────────────

/**
 * Returns the channel credentials/config object.
 */
export function getCommunicationChannel(channel: string): Record<string, unknown> | null {
  return load(channel)?.channel ?? null;
}
