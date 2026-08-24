/**
 * หน้าที่: ONE evidence-backed `CapabilityMetadata` candidate record for
 * the local Qwen model used by DNA-LAB-FILE-INTELLIGENCE's semantic-check
 * feature — Owner-requested 2026-08-17. This is a CANDIDATE record only:
 * no discovery logic produced it (that's still NOT_YET_BUILT, see
 * ../README.md), no circuit.json/capability-registry.ts entry exists for
 * it, nothing consumes this file yet. Every field was verified directly
 * against real source in the external DNA-LAB-FILE-INTELLIGENCE checkout
 * (~/Desktop/DNA-LAB-FILE-INTELLIGENCE) on 2026-08-17 — see
 * EVIDENCE_SOURCE below for exact file/line references.
 *
 * Input: none (one const value).
 * Output: `LOCAL_QWEN_SEMANTIC_CHECK_CANDIDATE`.
 * Dependency ที่อนุญาต: ../types.ts only.
 * สิ่งที่ห้ามแตะ: never mark this record's STATUS "VERIFIED" — the one
 * real target test case (case 15) FAILED (see EVIDENCE_SOURCE). Never
 * set PARENT_CAPABILITY to a guessed value — file-intelligence itself has
 * no proven capability-registry.ts wiring (contract/endpoint are both
 * "not_yet_built"), so there is no provable parent for this record either.
 */

import type { CapabilityMetadata } from "../types";

export const LOCAL_QWEN_SEMANTIC_CHECK_CANDIDATE: CapabilityMetadata = {
  SOFTWARE_ID: "local-qwen-semantic-check",

  // External repo — NOT part of the DNA-OS-INFRASTRUCTURE checkout. CapabilityMetadata
  // (Step 1 shape) has no dedicated repo-id field, unlike control/command-router/'s
  // CapabilityRegistration (which does) — encoded explicitly in the path string here;
  // flagged as a real schema gap for a future revision, not silently worked around.
  OWNER_FOLDER: "DNA-LAB-FILE-INTELLIGENCE/semantic-check/ (external repo, not in this checkout's control)",

  // Distinct from SOFTWARE_ID on purpose: this is a SUB-feature of file-intelligence's
  // own scanning pipeline, not a standalone capability with its own ingress today.
  CAPABILITY_ID: "file-intelligence.semantic-check",

  // No proof exists. file-intelligence itself is NOT_CONNECTED in
  // control/command-router/capability-registry.ts (contract: "not_yet_built",
  // endpoint.kind: "not_yet_built") — there is nothing to prove attachment to, even
  // one level up. Per Owner's rule ("do not guess parent"), this stays null.
  PARENT_CAPABILITY: null,

  // The ONLY real caller, repo-wide (verified via grep across DNA-LAB-FILE-INTELLIGENCE):
  // sandbox/runner/runSandbox.ts. Production src/cli.ts does not import semantic-check/
  // at all (verified: zero matches for "semantic" in src/cli.ts) — matches mlxClient.ts's
  // own header instruction not to wire it into production yet.
  INGRESS: ["sandbox/runner/runSandbox.ts (sandbox evaluation harness only — no production DNA-OS-INFRASTRUCTURE caller exists)"],

  // A local subprocess, not a network call: `python3 -m mlx_lm generate --model
  // mlx-community/Qwen3-4B-Instruct-2507-4bit ...` via Node's execFileSync.
  EGRESS: ["local subprocess: python3 -m mlx_lm generate (no network egress — mlxClient.ts's own header: \"No external LLM API is ever called\")"],

  // No dedicated contract.ts/adapter-contract.ts file exists for this feature — the
  // closest real thing is the exported function signatures themselves.
  CONTRACT: "DNA-LAB-FILE-INTELLIGENCE/semantic-check/mlxClient.ts (exports judgeSemanticEquivalence, SEMANTIC_MODEL_ID) + semanticDuplicateChecker.ts (exports runSemanticDuplicateCheck) — no dedicated contract file exists",

  RUNTIME_ENTRY: "runSemanticDuplicateCheck",

  // mlxClient.ts's own stated guarantee, verbatim in intent: "the model itself never
  // sees anything beyond the two code snippets it is asked to compare."
  DATA_CLASS: "source code snippets only (two code units under comparison per call) — local-only, no external transmission, no business/production data",

  REQUIRED_PERMISSION: "none",
  REQUIRED_CREDENTIAL: null, // local subprocess only — no API key, no token, no Vault reference of any kind

  DESTINATION: "local machine only (this same host's python3 mlx_lm CLI process) — zero network egress",

  EVIDENCE_SOURCE: [
    "DNA-LAB-FILE-INTELLIGENCE/semantic-check/mlxClient.ts:30 — SEMANTIC_MODEL_ID = \"mlx-community/Qwen3-4B-Instruct-2507-4bit\"",
    "DNA-LAB-FILE-INTELLIGENCE/semantic-check/mlxClient.ts:1-28 (file header) — states PIPELINE=VALID, MODEL=INSUFFICIENT, and explicitly instructs: \"Do not point production src/cli.ts at this module until a model demonstrably passes on the sandbox fixture\"",
    "DNA-LAB-FILE-INTELLIGENCE/semantic-check/semanticDuplicateChecker.ts:36-99 — runSemanticDuplicateCheck, the real (only) orchestration entry point",
    "DNA-LAB-FILE-INTELLIGENCE/sandbox/runner/runSandbox.ts:18,206-215,329-335 — the ONLY real caller repo-wide (verified via grep; production src/cli.ts has zero references to semantic-check)",
    "DNA-LAB-FILE-INTELLIGENCE/sandbox/manifests/15_semantic_duplicate_different_code.json — the one real target case this feature exists to solve (expected_detection: true, capE/currency.ts vs capF/priceLabel.ts)",
    "DNA-LAB-FILE-INTELLIGENCE/sandbox/results/semantic-check-telemetry.json — real run log, 4 entries, 2026-08-16T07:17:41Z-07:18:34Z. The target case's real recorded verdict: {\"fileA\":\"capE/currency.ts\",\"fileB\":\"capF/priceLabel.ts\",\"verdict\":\"UNKNOWN\",\"confidence\":0,\"reasoning_summary\":\"model output contained no parsable JSON object; treated as non-actionable\"} — the model FAILED to produce a usable answer on the one case designed to prove the capability works. The other 3 logged cases (all expected to NOT be flagged) correctly returned DIFFERENT_BEHAVIOR at confidence 0.99-1.0 — the pipeline mechanics work; the model's reliability on the actual target case does not.",
  ],

  // Not VERIFIED (Owner's explicit rule) and not simply RUNNING — a real verification
  // attempt against the one real target case already concluded, and it did not succeed
  // (UNKNOWN/unparsable output, not the required SAME_BEHAVIOR at >=0.6 confidence).
  // Not BLOCKED either: BLOCKED (per this registrar's own status rules) means a real,
  // NAMED EXTERNAL gap (e.g. a missing credential) — here the gap is the model's own
  // output reliability, not an external dependency. FAILED is the accurate state for
  // the semantic-DETECTION capability specifically; the surrounding pipeline code
  // (prefilter -> model call -> structured verdict -> confidence gate) is real, tested,
  // and runs correctly — only the model's actual judgment on the target case failed.
  STATUS: "FAILED",
};
