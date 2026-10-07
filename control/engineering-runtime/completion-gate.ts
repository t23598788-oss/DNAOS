/**
 * หน้าที่: Admission Gate for Engineering completion. Independently
 * compares original intent, registered repository, reservation, allowed
 * paths/symbols, actual diff, forbidden paths, test evidence, and
 * manifest hashes. Worker self-report is never trusted for those facts.
 *
 * Input: original admission + DNA OS derived manifest + optional claimed
 * manifest + observed paths + current HEAD.
 * Output: ALLOW or DENY with a closed reason code.
 * Dependency ที่อนุญาต: ./observe.ts, ./types.ts, ./repository.ts.
 * สิ่งที่ห้ามแตะ: never ALLOW when any required fact mismatches.
 */

import { inScope, sameStringSet } from "./observe";
import { resolveCodingRepository } from "./repository";
import type { EngineeringAdmission, EngineeringGateReason, EngineeringResultAdmission, EngineeringResultManifest } from "./types";

function deny(reason: EngineeringGateReason, detail: string, manifestId: string | null): EngineeringResultAdmission {
  return { decision: "DENY", reason_code: reason, detail, manifest_id: manifestId };
}

function claimedStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(String);
}

export function admitEngineeringResult(input: {
  readonly admission: EngineeringAdmission;
  readonly derived: EngineeringResultManifest;
  readonly claimed: unknown;
  readonly observed_paths: readonly string[];
  readonly checkout_root: string;
  readonly registered_head: string | null;
}): EngineeringResultAdmission {
  const derived = input.derived;
  const observed = [...input.observed_paths].sort();
  if (!sameStringSet(derived.changed_paths, observed)) {
    return deny("MANIFEST_SCOPE_MISMATCH", "derived changed_paths do not match DNA OS observed diff", derived.manifest_id);
  }

  const undeclared = observed.filter((path) => !inScope(path, input.admission.allowed_paths));
  if (undeclared.length > 0) {
    return deny("UNDECLARED_FILE_CHANGE", `undeclared path(s): ${undeclared.join(", ")}`, derived.manifest_id);
  }

  const forbiddenHit = observed.filter((path) => inScope(path, input.admission.forbidden_paths));
  if (forbiddenHit.length > 0) {
    return deny("FORBIDDEN_PATH_CHANGED", `forbidden path(s) changed: ${forbiddenHit.join(", ")}`, derived.manifest_id);
  }

  if (input.admission.allowed_symbols.length > 0) {
    const extra = derived.changed_symbols.filter((name) => !input.admission.allowed_symbols.includes(name));
    if (extra.length > 0) {
      return deny("SCOPE_EXPANDED", `changed symbols not in allowed_symbols: ${extra.join(", ")}`, derived.manifest_id);
    }
  }

  const failedTests = derived.actual_test_results.filter((row) => !row.passed);
  if (derived.required_tests.length === 0 || derived.actual_test_results.length !== derived.required_tests.length || failedTests.length > 0) {
    return deny("TEST_EVIDENCE_MISSING", failedTests.length > 0 ? failedTests.map((row) => `${row.name}:${row.evidence}`).join("; ") : "required test evidence missing", derived.manifest_id);
  }

  if (input.claimed !== undefined && input.claimed !== null) {
    if (typeof input.claimed !== "object") {
      return deny("MANIFEST_SCOPE_MISMATCH", "claimed manifest is not an object", derived.manifest_id);
    }
    const claimed = input.claimed as Record<string, unknown>;
    const claimedAllowed = claimedStringArray(claimed.allowed_paths);
    const claimedForbidden = claimedStringArray(claimed.forbidden_paths);
    const claimedChanged = claimedStringArray(claimed.changed_paths);
    const claimedRepo = typeof claimed.repository_id === "string" ? claimed.repository_id : null;
    const claimedReservation = typeof claimed.reservation_id === "string" ? claimed.reservation_id : null;
    const claimedBase = typeof claimed.base_commit_sha === "string" ? claimed.base_commit_sha : null;
    if (!claimedAllowed || !claimedForbidden || !claimedChanged || !claimedRepo || !claimedReservation || !claimedBase) {
      return deny("MANIFEST_SCOPE_MISMATCH", "claimed manifest is incomplete", derived.manifest_id);
    }
    if (claimedAllowed.some((path) => !inScope(path, input.admission.allowed_paths))) {
      return deny("SCOPE_EXPANDED", "claimed allowed_paths widen original authority", derived.manifest_id);
    }
    if (!sameStringSet(claimedAllowed, input.admission.allowed_paths)) {
      return deny("MANIFEST_SCOPE_MISMATCH", "claimed allowed_paths rewrite original authority", derived.manifest_id);
    }
    if (!sameStringSet(claimedAllowed, derived.allowed_paths) || !sameStringSet(claimedChanged, derived.changed_paths) || !sameStringSet(claimedForbidden, derived.forbidden_paths)) {
      return deny("MANIFEST_SCOPE_MISMATCH", "claimed manifest scope does not match DNA OS derived facts", derived.manifest_id);
    }
    if (claimedRepo !== derived.repository_id || claimedReservation !== derived.reservation_id || claimedBase !== derived.base_commit_sha) {
      return deny("MANIFEST_SCOPE_MISMATCH", "claimed identity/revision does not match DNA OS derived facts", derived.manifest_id);
    }
    const claimedAuth = claimed.worker_authority;
    if (claimedAuth && typeof claimedAuth === "object") {
      const auth = claimedAuth as Record<string, unknown>;
      for (const key of ["COMMIT", "PUSH", "PR", "DEPLOY"] as const) {
        if (auth[key] === "ALLOW" || (auth[key] !== undefined && auth[key] !== "DENY")) {
          return deny("MANIFEST_SCOPE_MISMATCH", `worker cannot set ${key} to ${String(auth[key])}`, derived.manifest_id);
        }
      }
    }
    const claimedArtifacts = claimed.produced_artifacts;
    if (Array.isArray(claimedArtifacts)) {
      for (const row of claimedArtifacts) {
        if (typeof row !== "object" || row === null) {
          return deny("MANIFEST_SCOPE_MISMATCH", "claimed artifact row is not an object", derived.manifest_id);
        }
        const path = String((row as { path?: unknown }).path ?? "");
        const hash = String((row as { sha256?: unknown }).sha256 ?? "");
        const derivedHash = derived.produced_artifacts.find((item) => item.path === path)?.sha256;
        if (!derivedHash || derivedHash !== hash) {
          return deny("MANIFEST_SCOPE_MISMATCH", `claimed hash for ${path || "(missing path)"} does not match DNA OS hash`, derived.manifest_id);
        }
      }
    } else {
      return deny("MANIFEST_SCOPE_MISMATCH", "claimed manifest omitted produced_artifacts hashes", derived.manifest_id);
    }
  }

  const identity = resolveCodingRepository(input.checkout_root);
  if (!identity.ok) {
    return deny(identity.reason_code, identity.detail, derived.manifest_id);
  }
  if (identity.repository.repository_id !== input.admission.repository_id || identity.repository.repository_id !== derived.repository_id) {
    return deny("REPOSITORY_IDENTITY_MISMATCH", "registered repository_id does not match admission/manifest", derived.manifest_id);
  }

  if (!input.registered_head || input.registered_head !== derived.base_commit_sha) {
    return deny("BASE_REVISION_MISMATCH", `registered base revision ${input.registered_head ?? "unknown"} != reservation base ${derived.base_commit_sha}`, derived.manifest_id);
  }

  if (!derived.definition_of_done.code || !derived.definition_of_done.tests || !derived.definition_of_done.machine_readable_contract || !derived.definition_of_done.human_documentation || !derived.definition_of_done.registry_connection_update || !derived.definition_of_done.evidence) {
    return deny("DEFINITION_OF_DONE_INCOMPLETE", "CODE + TESTS + CONTRACT + HUMAN DOCUMENTATION + REGISTRY + EVIDENCE are all required for VERIFIED", derived.manifest_id);
  }

  if (derived.worker_authority.COMMIT !== "DENY" || derived.worker_authority.PUSH !== "DENY" || derived.worker_authority.PR !== "DENY" || derived.worker_authority.DEPLOY !== "DENY") {
    return deny("MANIFEST_SCOPE_MISMATCH", "worker_authority must remain DENY for COMMIT/PUSH/PR/DEPLOY", derived.manifest_id);
  }

  return { decision: "ALLOW", reason_code: "ADMITTED", detail: "engineering result admission ALLOW", manifest_id: derived.manifest_id };
}
