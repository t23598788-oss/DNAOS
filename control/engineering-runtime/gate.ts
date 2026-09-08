/**
 * หน้าที่: parse and admit Owner ENGINEERING coding intent. Fail closed
 * before any worker is launched. Business authority cannot be admitted.
 *
 * Input: command envelope fields + payload.
 * Output: EngineeringAdmission.
 * Dependency ที่อนุญาต: ./types.ts, ./repository.ts,
 * ../work-resolution/contract.ts, ../../software/registry-database/adapters/persistent-file-store.ts.
 * สิ่งที่ห้ามแตะ: never admit when allowed_paths is missing/empty, equals
 * repository_root, required_tests is empty, forbidden_paths is missing,
 * or repository identity is missing/ambiguous.
 */

import { resolve } from "node:path";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { persistResolution, resolveWriteIntent } from "../work-resolution/contract";
import { resolveCodingRepository } from "./repository";
import {
  BUSINESS_AUTHORITY,
  ENGINEERING_AUTHORITY,
  type EngineeringAdmission,
  type EngineeringCodingIntent,
  type EngineeringGateReason,
} from "./types";

const BUSINESS_CAPABILITY_IDS: ReadonlySet<string> = new Set([
  "file-intelligence",
  "permission-reasoner",
  "research-engine",
  "execution",
  "github",
  "dna-os-circuit",
  "dispatcher",
  "agent-host",
  "os-login",
  "os-ui",
  "voice-bridge",
  "digitalocean",
]);

export function isBusinessCapabilityId(capabilityId: string | null | undefined): boolean {
  return typeof capabilityId === "string" && BUSINESS_CAPABILITY_IDS.has(capabilityId);
}

export function readEngineeringCodingIntent(payload: unknown): EngineeringCodingIntent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = (payload as { engineering_coding_intent?: unknown }).engineering_coding_intent;
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (body.authority === BUSINESS_AUTHORITY) return null;
  if (body.authority !== ENGINEERING_AUTHORITY) return null;
  if (!Array.isArray(body.allowed_paths) || !Array.isArray(body.required_tests) || !Array.isArray(body.forbidden_paths)) {
    return {
      authority: ENGINEERING_AUTHORITY,
      allowed_paths: Array.isArray(body.allowed_paths) ? body.allowed_paths.map(String) : [],
      allowed_symbols: Array.isArray(body.allowed_symbols) ? body.allowed_symbols.map(String) : [],
      required_tests: Array.isArray(body.required_tests) ? body.required_tests.map(String) : [],
      forbidden_paths: Array.isArray(body.forbidden_paths) ? body.forbidden_paths.map(String) : [],
      requested_function: typeof body.requested_function === "string" ? body.requested_function : "",
      requested_change: typeof body.requested_change === "string" ? body.requested_change : "",
      target_domain: typeof body.target_domain === "string" ? body.target_domain : "",
      owner_intent: typeof body.owner_intent === "string" ? body.owner_intent : "",
    };
  }
  return {
    authority: ENGINEERING_AUTHORITY,
    allowed_paths: body.allowed_paths.map(String),
    allowed_symbols: Array.isArray(body.allowed_symbols) ? body.allowed_symbols.map(String) : [],
    required_tests: body.required_tests.map(String),
    forbidden_paths: body.forbidden_paths.map(String),
    requested_function: typeof body.requested_function === "string" ? body.requested_function : "",
    requested_change: typeof body.requested_change === "string" ? body.requested_change : "",
    target_domain: typeof body.target_domain === "string" ? body.target_domain : "",
    owner_intent: typeof body.owner_intent === "string" ? body.owner_intent : "",
  };
}

function normalizeRel(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function hasTraversal(path: string): boolean {
  return path.includes("..") || path.startsWith("/") || /^[a-zA-Z]:/.test(path);
}

function deny(
  commandId: string,
  workId: string,
  reason: EngineeringGateReason,
  detail: string,
  extra: Partial<EngineeringAdmission> = {},
): EngineeringAdmission {
  return {
    admitted: false,
    reason_code: reason,
    detail,
    repository_id: extra.repository_id ?? null,
    repository_root: extra.repository_root ?? null,
    allowed_paths: extra.allowed_paths ?? [],
    allowed_symbols: extra.allowed_symbols ?? [],
    required_tests: extra.required_tests ?? [],
    forbidden_paths: extra.forbidden_paths ?? [],
    work_resolution_decision: extra.work_resolution_decision ?? null,
    work_id: workId,
    command_id: commandId,
  };
}

export function admitEngineeringCoding(input: {
  readonly command_id: string;
  readonly work_id: string;
  readonly checkout_root: string;
  readonly payload: unknown;
  readonly selected_capability_id?: string | null;
}): EngineeringAdmission {
  if (isBusinessCapabilityId(input.selected_capability_id)) {
    return deny(input.command_id, input.work_id, "BUSINESS_CANNOT_ENTER_ENGINEERING_WRITE", `capability ${input.selected_capability_id} is Business Runtime — zero source-write authority`);
  }

  const intent = readEngineeringCodingIntent(input.payload);
  if (!intent) {
    return deny(input.command_id, input.work_id, "MISSING_CODING_SCOPE", "engineering_coding_intent with authority=ENGINEERING is required");
  }

  const allowed = intent.allowed_paths.map(normalizeRel).filter((p) => p.length > 0);
  if (allowed.length === 0) {
    return deny(input.command_id, input.work_id, "MISSING_CODING_SCOPE", "allowed_paths is required and must be non-empty");
  }
  if (intent.required_tests.length === 0) {
    return deny(input.command_id, input.work_id, "MISSING_REQUIRED_TESTS", "required_tests must not be empty for a coding work order");
  }
  if (!Array.isArray(intent.forbidden_paths) || intent.forbidden_paths.length === 0) {
    return deny(input.command_id, input.work_id, "MISSING_FORBIDDEN_PATHS", "forbidden_paths must be populated explicitly");
  }
  if (allowed.some(hasTraversal) || intent.forbidden_paths.some((p) => hasTraversal(normalizeRel(p)))) {
    return deny(input.command_id, input.work_id, "PATH_TRAVERSAL", "coding paths must be repo-relative without traversal");
  }

  const identity = resolveCodingRepository(input.checkout_root);
  if (!identity.ok) {
    return deny(input.command_id, input.work_id, identity.reason_code, identity.detail);
  }
  const repositoryRoot = resolve(input.checkout_root);
  const rootNorm = normalizeRel(repositoryRoot);
  if (allowed.some((p) => p === "." || p === rootNorm || resolve(input.checkout_root, p) === repositoryRoot)) {
    return deny(input.command_id, input.work_id, "REPOSITORY_ROOT_USED_AS_WRITE_SCOPE", "coding write scope must be explicit paths, never repository_root", {
      repository_id: identity.repository.repository_id,
      repository_root: repositoryRoot,
    });
  }

  const targetDomain = intent.target_domain.trim() || allowed[0]!.replace(/\/[^/]+$/, "") || allowed[0]!;
  const resolved = resolveWriteIntent({
    requested_function: intent.requested_function || "scoped coding change",
    requested_change: intent.requested_change || intent.owner_intent || "modify allowed path only",
    target_domain: targetDomain,
    owner_intent: intent.owner_intent || intent.requested_change,
    current_work_id: input.work_id,
  }, createPersistentFileStore());
  persistResolution(resolved);

  if (!resolved.dispatchable || resolved.decision === "UNRESOLVED") {
    return deny(input.command_id, input.work_id, "WORK_RESOLUTION_NOT_DISPATCHABLE", resolved.blocking_reason || `work-resolution decision=${resolved.decision}`, {
      repository_id: identity.repository.repository_id,
      repository_root: repositoryRoot,
      work_resolution_decision: resolved.decision,
    });
  }

  const resolutionScope = resolved.allowed_write_scope.map(normalizeRel).filter((p) => p.length > 0);
  const intersection = allowed.filter((path) => resolutionScope.some((scope) => path === scope || path.startsWith(`${scope}/`) || scope.startsWith(`${path}/`)));
  if (intersection.length === 0) {
    return deny(input.command_id, input.work_id, "SCOPE_INTERSECTION_EMPTY", "Owner allowed_paths do not intersect work-resolution allowed_write_scope", {
      repository_id: identity.repository.repository_id,
      repository_root: repositoryRoot,
      work_resolution_decision: resolved.decision,
      allowed_paths: allowed,
    });
  }

  return {
    admitted: true,
    reason_code: "ADMITTED",
    detail: `engineering coding admitted repository_id=${identity.repository.repository_id} decision=${resolved.decision}`,
    repository_id: identity.repository.repository_id,
    repository_root: repositoryRoot,
    allowed_paths: intersection,
    allowed_symbols: intent.allowed_symbols,
    required_tests: intent.required_tests,
    forbidden_paths: intent.forbidden_paths.map(normalizeRel),
    work_resolution_decision: resolved.decision,
    work_id: input.work_id,
    command_id: input.command_id,
  };
}
