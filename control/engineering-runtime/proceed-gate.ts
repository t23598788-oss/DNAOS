/**
 * หน้าที่: Engineering Completion Gate for GitHub and Registry.
 * Only this module may allow publication or registry write. Worker
 * self-report is never sufficient.
 *
 * Input: lifecycle stage + DNA OS completion + publication SHA facts.
 * Output: allow_publish / allow_registry or fail-closed reason.
 * Dependency ที่อนุญาต: ./lifecycle.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never ALLOW registry before remote SHA match.
 */

import { TERMINAL_ENGINEERING_STAGES, type EngineeringLifecycleStage } from "./lifecycle";
import type { EngineeringCompletionResult, EngineeringPublicationResult } from "./types";
import type { GithubPermanenceProof } from "./github-permanence";

export function mayProceedToPublish(input: {
  readonly stage: EngineeringLifecycleStage;
  readonly completion: EngineeringCompletionResult | null;
  readonly worker_claimed_complete: boolean;
}): { readonly allow: boolean; readonly detail: string } {
  if (input.stage !== "READY_TO_PUBLISH") {
    return { allow: false, detail: `publish refused at stage ${input.stage}` };
  }
  if (!input.completion || input.completion.status !== "VERIFIED" || input.completion.result_admission.decision !== "ALLOW") {
    return { allow: false, detail: "publish requires DNA OS VERIFIED completion with ALLOW admission" };
  }
  return { allow: true, detail: input.worker_claimed_complete
    ? "engineering completion gate ALLOW publish (worker claimed_complete ignored)"
    : "engineering completion gate ALLOW publish" };
}

export function mayProceedToRegistry(input: {
  readonly stage: EngineeringLifecycleStage;
  readonly publication: EngineeringPublicationResult | null;
  readonly github_proof?: GithubPermanenceProof | null;
}): { readonly allow: boolean; readonly detail: string } {
  if (input.stage !== "REGISTRY_UPDATE") {
    return { allow: false, detail: `registry refused at stage ${input.stage}` };
  }
  const sha = input.publication?.lineage.dna_os_commit_sha;
  const remote = input.publication?.lineage.post_publish_remote_sha;
  if (!input.publication || input.publication.status !== "VERIFIED" || !sha || !remote || sha !== remote) {
    return { allow: false, detail: "registry requires GitHub VERIFIED and remote SHA match" };
  }
  if (!input.github_proof || input.github_proof.status !== "CI_VERIFIED" || !input.github_proof.lineage_verified || !input.github_proof.expected_files_verified) {
    return { allow: false, detail: "registry requires GitHub permanence CI_VERIFIED with lineage and expected files" };
  }
  if (input.github_proof.remote_sha !== sha) {
    return { allow: false, detail: "registry requires permanence proof SHA to match the published commit" };
  }
  return { allow: true, detail: "engineering completion gate ALLOW registry" };
}

export function isTerminalEngineeringStage(stage: EngineeringLifecycleStage): boolean {
  return TERMINAL_ENGINEERING_STAGES.has(stage);
}
