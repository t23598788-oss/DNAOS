#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}([a-f0-9]{24})?$/;
const STATUSES = new Set(["VERIFIED", "UNVERIFIED", "CONFLICT", "BLOCKED", "FAIL"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function evaluateAdmission({ root = ROOT, mode = "review" } = {}) {
  if (!new Set(["review", "production"]).has(mode)) throw new Error(`Unsupported gate mode: ${mode}`);
  const errors = [];
  const warnings = [];
  const policyPath = join(root, "registry/AI_WORK_ADMISSION_POLICY.json");
  const identityPath = join(root, "registry/DNA_ID_REGISTRY.json");
  let policy;
  let identity;
  try { policy = readJson(policyPath); } catch { errors.push("Admission policy is missing or invalid JSON."); }
  try { identity = readJson(identityPath); } catch { errors.push("DNA identity registry is missing or invalid JSON."); }

  if (policy) {
    if (policy.version !== 1 || policy.gate_id !== "DNA-GATE-000001") errors.push("Unsupported or mismatched admission policy version/gate ID.");
    const required = ["identify the repository", "declare the requested scope", "compare claims with source", "run focused checks", "preserve unresolved conflicts", "block production"];
    for (const phrase of required) {
      if (!policy.required_steps?.some((step) => step.toLowerCase().includes(phrase.toLowerCase()))) errors.push(`Required process step is absent: ${phrase}.`);
    }
    if (policy.evidence_directory !== "registry/evidence") errors.push("Evidence directory must be the governed registry/evidence path.");
  }
  if (policy && identity && !identity.identities?.some((entry) => entry.dna_id === policy.dna_id && entry.repository === policy.repository && entry.status === "active")) {
    errors.push("Admission policy DNA ID is not active for the declared repository.");
  }

  const evidenceDir = join(root, policy?.evidence_directory ?? "registry/evidence");
  let files = [];
  try { files = readdirSync(evidenceDir).filter((name) => name.endsWith(".json")).sort(); }
  catch { errors.push("Evidence directory is missing or unreadable."); }

  const productionRule = policy?.production_evidence_rule;
  for (const file of files) {
    const path = join(evidenceDir, file);
    let record;
    try { record = readJson(path); } catch { errors.push(`${file}: invalid JSON.`); continue; }
    const prefix = `${file}:`;
    if (record.record_version !== 1 || typeof record.record_type !== "string") errors.push(`${prefix} unsupported evidence record format.`);
    if (!STATUSES.has(record.status)) errors.push(`${prefix} invalid evidence status.`);
    if (record.dna_id !== policy?.dna_id) errors.push(`${prefix} DNA ID does not match the active admission policy.`);
    if (record.production_dependency !== true && record.production_dependency !== false) errors.push(`${prefix} must explicitly declare production_dependency true or false.`);
    if (!record.source || typeof record.source.commit_sha !== "string" || !COMMIT.test(record.source.commit_sha)) errors.push(`${prefix} source commit SHA is missing or malformed.`);
    if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) errors.push(`${prefix} has no hashed artifacts.`);
    for (const artifact of record.artifacts ?? []) {
      if (typeof artifact.path !== "string" || !artifact.path || !HASH.test(artifact.sha256 ?? "")) errors.push(`${prefix} artifact path/hash is invalid.`);
    }
    if (/https?:\/\/[^\s]*:[^\s]*@/i.test(JSON.stringify(record))) errors.push(`${prefix} contains a credential-bearing URL.`);
    if (record.production_dependency === true && productionRule) {
      if (record.status !== "VERIFIED") errors.push(`${prefix} is a production dependency with status ${record.status}; production requires VERIFIED.`);
      const requiredFlags = productionRule.required_runtime_evidence_flags ?? [];
      if (requiredFlags.length === 0 || requiredFlags.some((flag) => record.deployment_evidence?.[flag] !== true)) {
        errors.push(`${prefix} is a production dependency without all deployment evidence flags set true.`);
      }
    } else if (record.status !== "VERIFIED") {
      warnings.push(`${file} remains ${record.status} and is explicitly outside the production dependency set.`);
    }
  }

  return { mode, errors, warnings, evidence_count: files.length, passed: errors.length === 0 };
}

function main() {
  const modeIndex = process.argv.indexOf("--mode");
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : "review";
  const result = evaluateAdmission({ mode });
  console.log(`=== DNA OS AI Work Admission Gate (${result.mode}) ===`);
  console.log(`Evidence records: ${result.evidence_count}`);
  for (const warning of result.warnings) console.log(`WARN: ${warning}`);
  for (const error of result.errors) console.error(`BLOCK: ${error}`);
  console.log(result.passed ? "Admission: PASS" : "Admission: BLOCKED");
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
