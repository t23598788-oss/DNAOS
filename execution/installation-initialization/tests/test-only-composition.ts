/**
 * Explicit test-only full composition. It is not a production export and
 * requires a caller-supplied isolated DNA_OS_STATE_ROOT. This is the only
 * place in this slice that exercises generation and persistence together.
 */

import { randomUUID } from "node:crypto";
import { buildInitializationRecord } from "../../../contracts/installation/installation-initialization";
import { readInstallationInitialization } from "../contract";
import { createInstallationInitializationFromCeremony } from "../restricted";
import { authorizeLocalInstallationCeremonyEntry, type LocalInstallationCeremonyInvocationV1 } from "../ceremony";
import { DNA_OS_STATE_ROOT_ENV } from "../../local-state-root/contract";

export interface LocalInstallationCeremonyEvidenceV1 {
  readonly boundary_id: string;
  readonly boundary_version: string;
  readonly authority_basis: string;
  readonly invocation_mode: string;
  readonly invocation_correlation: string;
  readonly execution_context: "LOCAL_OS_USER_CONTEXT";
  readonly ceremony_timestamp: string;
  readonly operation: "INITIALIZE_INSTALLATION";
}

export type TestOnlyCompositionResult =
  | { readonly status: "INITIALIZATION_CREATED"; readonly installation_id: string; readonly initialization_id: string; readonly record_digest: string; readonly evidence: LocalInstallationCeremonyEvidenceV1 }
  | { readonly status: "ALREADY_INITIALIZED"; readonly initialization_id: string }
  | { readonly status: "CONFLICT" | "CORRUPT" | "FAILED" | "INVALID_INVOCATION" | "NOT_READY"; readonly reason: string };

export function runTestOnlyLocalInitializationCeremony(
  invocation: unknown,
  isolatedStateRoot: string,
  now: string,
): TestOnlyCompositionResult {
  const previous = process.env[DNA_OS_STATE_ROOT_ENV];
  process.env[DNA_OS_STATE_ROOT_ENV] = isolatedStateRoot;
  try {
    const entry = authorizeLocalInstallationCeremonyEntry(invocation);
    if (entry.status === "INVALID_INVOCATION") return { status: entry.status, reason: entry.reason };
    if (entry.status !== "AUTHORIZED_FOR_CEREMONY_ENTRY") return { status: "NOT_READY", reason: "CEREMONY_EXECUTION_DISARMED" };

    const current = readInstallationInitialization();
    if (current.state === "INITIALIZED") return { status: "ALREADY_INITIALIZED", initialization_id: current.initialization.initialization_id };
    if (current.state === "CORRUPT") return { status: "CORRUPT", reason: current.reason_code };

    const typedInvocation = invocation as LocalInstallationCeremonyInvocationV1;
    const evidence: LocalInstallationCeremonyEvidenceV1 = {
      boundary_id: entry.boundary.boundary_id,
      boundary_version: entry.boundary.boundary_version,
      authority_basis: typedInvocation.authority_basis,
      invocation_mode: typedInvocation.invocation_mode,
      invocation_correlation: `ceremony-${randomUUID()}`,
      execution_context: "LOCAL_OS_USER_CONTEXT",
      ceremony_timestamp: now,
      operation: typedInvocation.operation,
    };
    const candidate = `installation-${randomUUID()}`;
    const built = buildInitializationRecord({
      installation_id: candidate,
      created_at: now,
      evidence_refs: ["execution/installation-initialization/tests/test-only-composition.ts#runTestOnlyLocalInitializationCeremony"],
    });
    if (!built.ok) return { status: "FAILED", reason: built.reason_code };
    const created = createInstallationInitializationFromCeremony(built.record);
    if (created.result === "CREATED") {
      const readBack = readInstallationInitialization();
      if (readBack.state !== "INITIALIZED" || readBack.initialization.installation_id !== candidate || readBack.initialization.initialization_id !== built.record.initialization_id || readBack.initialization.record_digest !== built.record.record_digest) {
        return { status: "CORRUPT", reason: "READBACK_IDENTITY_MISMATCH" };
      }
      return { status: "INITIALIZATION_CREATED", installation_id: candidate, initialization_id: built.record.initialization_id, record_digest: built.record.record_digest, evidence };
    }
    if (created.result === "REPLAY") return { status: "ALREADY_INITIALIZED", initialization_id: created.initialization.initialization_id };
    if (created.result === "CONFLICT") return { status: "CONFLICT", reason: created.detail };
    return { status: created.result === "CORRUPT" ? "CORRUPT" : "FAILED", reason: created.detail };
  } finally {
    if (previous === undefined) delete process.env[DNA_OS_STATE_ROOT_ENV];
    else process.env[DNA_OS_STATE_ROOT_ENV] = previous;
  }
}
