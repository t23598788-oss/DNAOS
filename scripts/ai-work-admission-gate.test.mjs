#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAdmission } from "./ai-work-admission-gate.mjs";

const scratch = mkdtempSync(join(tmpdir(), "dnaos-admission-gate-"));
const policy = JSON.parse(readFileSync(new URL("../registry/AI_WORK_ADMISSION_POLICY.json", import.meta.url), "utf8"));
const identities = JSON.parse(readFileSync(new URL("../registry/DNA_ID_REGISTRY.json", import.meta.url), "utf8"));
const source = JSON.parse(readFileSync(new URL("../registry/evidence/cloudflare-guard-artifact-2c56b37c.json", import.meta.url), "utf8"));
const setup = (record) => {
  mkdirSync(join(scratch, "registry/evidence"), { recursive: true });
  writeFileSync(join(scratch, "registry/AI_WORK_ADMISSION_POLICY.json"), JSON.stringify(policy));
  writeFileSync(join(scratch, "registry/DNA_ID_REGISTRY.json"), JSON.stringify(identities));
  writeFileSync(join(scratch, "registry/evidence/evidence.json"), JSON.stringify(record));
};

try {
  setup(source);
  const review = evaluateAdmission({ root: scratch, mode: "review" });
  assert.equal(review.passed, true, "a valid but explicitly non-production unverified record is retained");
  assert.equal(review.warnings.length, 1, "unverified evidence is visible as a warning");

  const unsafeDependency = { ...source, production_dependency: true };
  setup(unsafeDependency);
  const blocked = evaluateAdmission({ root: scratch, mode: "production" });
  assert.equal(blocked.passed, false, "production blocks unverified dependencies");
  assert.ok(blocked.errors.some((error) => error.includes("production requires VERIFIED")));

  setup({ ...source, source: { ...source.source, commit_sha: "not-a-commit" } });
  const malformed = evaluateAdmission({ root: scratch, mode: "review" });
  assert.equal(malformed.passed, false, "malformed provenance is blocked");
  assert.ok(malformed.errors.some((error) => error.includes("source commit SHA")));

  setup({ ...source, production_dependency: true, status: "VERIFIED", deployment_evidence: { worker_deployment_verified: true } });
  const missingFlags = evaluateAdmission({ root: scratch, mode: "production" });
  assert.equal(missingFlags.passed, false, "production blocks incomplete runtime evidence even when status is VERIFIED");
  assert.ok(missingFlags.errors.some((error) => error.includes("deployment evidence flags")));

  const deployGate = readFileSync(new URL("../scripts/deploy-gate.ts", import.meta.url), "utf8");
  const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/governance.yml", import.meta.url), "utf8");
  assert.ok(deployGate.includes("ai-work-admission-gate.mjs --mode production"), "real deploy gate invokes the production admission check");
  assert.ok(agents.includes("registry/AI_WORK_ADMISSION_POLICY.json") && agents.includes("npm run ai:admission"), "repo agent instructions point every AI to the same policy and check");
  assert.ok(workflow.includes("npm run ai:admission:test"), "GitHub governance runs the admission regression suite");
  console.log("AI work admission tests: 7/7 PASS");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
