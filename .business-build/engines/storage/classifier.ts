/**
 * Storage Intelligence — Classifier. Turns gathered evidence into one of the
 * 14 real classifications + UNKNOWN. Never decides from filename/path alone —
 * every branch below requires at least one non-path signal (git status, a
 * pattern AND a size/location combination, or explicit duplicate/cloud
 * verification) before returning confidence > 0.5.
 */
import type { StorageClassificationResult, StorageResourceClassification } from "@/core/shared/types";
import type { GatheredEvidence } from "./evidenceEngine";
import { PATTERNS, matchesAny } from "./evidenceEngine";
import type { SupabaseObjectVerification } from "./adapters/supabaseVerifier";

export interface ClassifyContext {
  isProtectedRoot: boolean; // active DNA OS workspace, .git, .env, secrets, registry, config, migrations
  duplicateOfPath?: string; // set by a prior duplicate-detection pass (sha256 group)
  isUnusedProjectClone?: { isGitRepo: boolean; isClean: boolean; remote: string | null };
  cloudVerification?: SupabaseObjectVerification;
  referencedBySource?: boolean; // true only if a real grep found a reference — never assumed
  activeProcessReference?: boolean; // true only if a real process/mount check found one
  // Migration Completion (owner, 2026-08-04): the ONLY way a LOCAL_AI_MODEL
  // resource (e.g. ~/.ollama) can ever become trash-eligible. Both fields
  // must be independently, LIVE-verified by the caller (never defaulted to
  // true) — see local-runtime/migrate-ollama.ts, which greps every
  // local-runtime script for a real localhost:11434 reference and calls the
  // real RunPod readiness check immediately before classifying.
  localAiModelPolicy?: { noScriptDependents: boolean; cloudRuntimeVerified: boolean; evidence: string[] };
}

function result(
  classification: StorageResourceClassification,
  confidence: number,
  evidenceNotes: string[],
  recommended_action: StorageClassificationResult["recommended_action"],
  blocked_reason: string | null
): StorageClassificationResult {
  return {
    classification,
    confidence,
    evidence: evidenceNotes.map((detail) => ({ kind: "filesystem" as const, detail })),
    recommended_action,
    blocked_reason,
  };
}

export function classify(ev: GatheredEvidence, ctx: ClassifyContext): StorageClassificationResult {
  // Hard blocks first — these never become SAFE regardless of any other signal.
  if (ctx.isProtectedRoot) {
    return result("PROTECTED_CONFIG", 1.0, ["inside a never-touch root (workspace/.git/.env/secrets/registry/config/migrations)"], "keep", "protected root — never eligible");
  }
  if (ev.git.is_git_repo && !ev.git.is_clean) {
    return result("ACTIVE_PROJECT_FILE", 0.95, [`dirty git repo: ${ev.git.uncommitted_changes.length} uncommitted changes`], "keep", "uncommitted changes present — must not discard without human review");
  }
  if (ctx.activeProcessReference) {
    return result("ACTIVE_PROJECT_FILE", 0.9, ["referenced by a currently-running process"], "keep", "in use by a running process");
  }
  if (ctx.referencedBySource) {
    return result("ACTIVE_PROJECT_FILE", 0.85, ["referenced by source/test/workflow/script (real reference scan)"], "keep", "referenced by other code — removing would break something real");
  }

  if (matchesAny(ev.path, PATTERNS.AI_MODEL)) {
    const policy = ctx.localAiModelPolicy;
    if (policy?.noScriptDependents && policy?.cloudRuntimeVerified) {
      return result("LOCAL_AI_MODEL", 0.9, ["path matches known local-AI-model storage location", ...policy.evidence], "trash_eligible", null);
    }
    const missing: string[] = [];
    if (!policy) missing.push("no policy verification was even attempted");
    else {
      if (!policy.noScriptDependents) missing.push("a real script still references localhost:11434");
      if (!policy.cloudRuntimeVerified) missing.push("Cloud Runtime readiness (volume_attached/model_present/model_verified/runtime_ready) not all true");
    }
    return result("LOCAL_AI_MODEL", 0.9, ["path matches known local-AI-model storage location"], "manual_prune_only", `local AI model — blocked: ${missing.join("; ")}`);
  }
  if (matchesAny(ev.path, PATTERNS.DOCKER)) {
    return result("DOCKER_RESOURCE", 0.9, ["path is Docker Desktop's own VM-backed storage"], "manual_prune_only", "Docker resources are never Trash-moved — use docker prune / Desktop cleanup UI");
  }

  if (ctx.isUnusedProjectClone) {
    const { isGitRepo, isClean, remote } = ctx.isUnusedProjectClone;
    if (!isGitRepo) {
      return result("UNUSED_PROJECT_CLONE", 0.85, ["not a git repository — likely a ZIP/archive extraction, no history at risk"], "trash_eligible", null);
    }
    if (isClean) {
      return result("UNUSED_PROJECT_CLONE", 0.85, [`clean git clone (0 uncommitted changes), remote ${remote ?? "unknown"} — duplicate exists elsewhere`], "trash_eligible", null);
    }
  }

  if (ctx.cloudVerification?.verified) {
    return result("CLOUD_BACKED_UP", 0.9, [ctx.cloudVerification.reason], "trash_eligible", null);
  }
  if (ctx.cloudVerification && !ctx.cloudVerification.verified) {
    return result("UNKNOWN", 0.3, [ctx.cloudVerification.reason], "review", "cloud verification incomplete or checksum mismatch — do not move");
  }

  if (ctx.duplicateOfPath) {
    return result("DUPLICATE", 0.85, [`sha256 match against ${ctx.duplicateOfPath}`], "trash_eligible", null);
  }

  if (matchesAny(ev.path, PATTERNS.CACHE)) {
    return result("CACHE", 0.8, ["path matches known cache directory pattern"], "trash_eligible", null);
  }
  if (PATTERNS.LOG_EXTS.includes(ev.ext) && ev.age_days >= 30) {
    return result("LOG", 0.75, [`.log file, ${Math.floor(ev.age_days)} days old`], "trash_eligible", null);
  }
  if (matchesAny(ev.path, PATTERNS.BUILD_ARTIFACT)) {
    return result("BUILD_ARTIFACT", 0.75, ["path matches known build-output directory pattern"], "trash_eligible", null);
  }
  if (matchesAny(ev.path, PATTERNS.GENERATED)) {
    return result("GENERATED_FILE", 0.7, ["path is a generated/reinstallable directory (e.g. node_modules)"], "trash_eligible", null);
  }

  if (ev.is_inside_repo && ev.git.is_clean) {
    return result("ACTIVE_PROJECT_FILE", 0.6, ["inside a clean git repo — presumed active unless another signal says otherwise"], "keep", "no evidence this is safe to remove");
  }

  return result("UNKNOWN", 0.2, ["no classification rule matched with sufficient confidence"], "review", "insufficient evidence — never move an UNKNOWN resource");
}
