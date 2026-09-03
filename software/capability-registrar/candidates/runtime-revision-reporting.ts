/**
 * หน้าที่: the `RegistrationCandidate` for the RUNTIME REVISION REPORTING
 * capability — the hop that let a running DNA OS process state which source
 * revision it is actually executing. Before it, Railway knew the deployed
 * commit and the process did not, so the delivery circuit could never close
 * SOURCE == GITHUB == DEPLOYED == RUNNING.
 *
 * EVERY FIELD BELOW IS EVIDENCE, NOT DESCRIPTION. `evidence_refs` name real
 * files and real observed outputs that exist right now.
 * Input: none (a data record).
 * Output: RUNTIME_REVISION_CANDIDATE.
 * Dependency ที่อนุญาต: control/event-pipeline/registration-contract (type only).
 * สิ่งที่ห้ามแตะ: ห้ามแก้ evidence_refs ให้ชี้สิ่งที่ไม่มีอยู่จริง และห้าม
 * ประกาศ repository claim เพราะ repository-registry ยังไม่มี id ของรีโปนี้.
 */
import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const RUNTIME_REVISION_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-runtime-revision-reporting-v1",
  name: "runtime-revision-reporting",
  kind: "capability",
  source_location: "control/runtime-revision/contract.ts",
  owner: "DNA-OS-INFRASTRUCTURE/control/runtime-revision/",

  input: [
    "process environment variable RAILWAY_GIT_COMMIT_SHA",
    "process environment variable DNA_OS_SOURCE_REVISION",
    "the local git working tree the process runs from, when there is one",
  ],
  output: [
    "RuntimeRevision: revision - a 40-hex commit sha or null",
    "RuntimeRevision: source - RAILWAY_BUILD, EXPLICIT_ENV, LOCAL_GIT_WORKTREE or NONE",
    "RuntimeRevision: dirty - true when the working tree differs from the reported commit",
    "RuntimeRevision: reason - stated only when revision is null",
    "GET /health additive fields revision, revision_source, revision_dirty, revision_reason",
  ],
  side_effects: [
    "reads process environment",
    "runs git rev-parse HEAD and git status --porcelain read-only in the process working directory",
  ],
  dependencies: [
    "transport/owner-command-http/server.ts - the existing health contract this extends rather than replaces",
    "node:child_process - the only host API used",
  ],

  behavior:
    "report_the_revision_this_process_is_actually_running: resolves the revision from the first real source that exists, in the order Railway build injection, explicit environment override, local git working tree, and reports which of those it came from. When no source exists it returns a null revision with the reason stated, never a substituted or inferred commit. A local working tree with uncommitted changes is reported dirty, so a matching sha is never mistaken for byte-identical code.",

  version: "1.0.0",

  evidence_refs: [
    "control/runtime-revision/contract.ts",
    "transport/owner-command-http/server.ts",
    "observed output revision=1669c8f5bff15207beb1c145279aa45117f6da9d source=LOCAL_GIT_WORKTREE dirty=true",
    "observed GET /health on an isolated instance returning ok=true plus the four additive revision fields",
    "railway deployment meta commitHash=1669c8f5bff15207beb1c145279aa45117f6da9d for services owner-command-http and joint-monitor",
    "git ls-remote origin HEAD = 1669c8f5bff15207beb1c145279aa45117f6da9d",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "delivery/revision-identity",
};
