#!/usr/bin/env npx tsx
/**
 * Deploy Gate (MISSION, registry/CHANGELOG.json DNA-000053, Rule 106 step 5).
 *
 * "Deployment ไม่มีสิทธิ์ PASS จนกว่า Runtime จะยืนยันว่า PASS — หาก FAIL ต้อง
 * อธิบายเป็นภาษาคน" — a bare exit code is not an explanation. This reuses the
 * real, already-built infrastructure rather than creating anything new:
 *   - scripts/governance.sh (already computes real PASS/FAIL per check + writes
 *     DNA_OS_HEALTH.json) — this script RUNS it, does not reimplement it.
 *   - registry/VALIDATION_RESULTS.json (DNA-000050/051) — already carries real
 *     root_cause/evidence/suggested_fix per FAIL when the caller supplied them;
 *     this script reads the LATEST matching entry per failing check to render
 *     the human-readable block, not fabricate one.
 *   - registry/existence.json known_mistakes — cross-referenced the same way
 *     record-validation.ts already does, so a FAIL that matches a known mistake
 *     surfaces its lesson too.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { recordKnowledgeEntry } from "../services/knowledge/client";
import {
  buildDevLoopProblemReport,
  persistDevLoopProblemReport,
  resolvePersistedDevLoopProblem,
} from "../engines/workspace/problemReport";

// Rule 71 fix (owner, 2026-08-05): engines/workspace/problemReport.ts used to
// construct its own Supabase client as a fallback when no `db` was passed —
// a real engines/ -> @supabase/supabase-js direct import, caught by
// scripts/pre-commit-check.sh's Guard 3. This script (not under engines/) is
// the right place to construct the client; problemReport.ts now requires the
// caller to inject it, same as every other engines/workspace/* module.
async function getDb() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return undefined;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

const ROOT = join(__dirname, "..");

// Standalone CLI runs do not receive Next.js env loading. Without this, the
// Dev Loop check is skipped even when the local Supabase credentials exist.
try {
  const envFile = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1);
  }
} catch {
  // CI/deploy environments provide variables through the process environment.
}

function readJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8"));
}

// Keys here are DNA_OS_HEALTH.json's real "checks" object keys (governance.sh's
// heredoc field names), NOT governance.sh's internal score-tracking keys
// (pre_commit/dead_code/duplicates/etc — a different, shorter set used only
// inside set_score/get_score). Confirmed by reading DNA_OS_HEALTH.json directly
// after a live run — first version of this file used the wrong key set and
// silently rendered only 1 of 4 real failing checks; found by testing against
// real output before shipping, same discipline as every guard built this session.
const CHECK_KEY_TO_VALIDATOR: Record<string, { validator: string; module: string }> = {
  type_check: { validator: "Type Check (tsc)", module: "governance" },
  pre_commit_guards: { validator: "Pre-commit Guards", module: "governance" },
  dead_code_policy: { validator: "Dead Code Policy (knip)", module: "governance" },
  duplicate_detector: { validator: "Duplicate Detector (jscpd)", module: "governance" },
  shadow_system: { validator: "Module Registry (No Shadow)", module: "governance" },
  command_registry: { validator: "Command Registry", module: "governance" },
  dependency_graph: { validator: "Dependency Graph", module: "governance" },
  architecture_drift: { validator: "Architecture Drift", module: "governance" },
};

interface ValidationResultEntry {
  validator: string;
  result: string;
  root_cause?: string;
  evidence?: string;
  suggested_fix?: string;
  command?: string;
}

function latestMatchingResult(validator: string): ValidationResultEntry | null {
  const ledger = existsSync(join(ROOT, "registry/VALIDATION_RESULTS.json"))
    ? readJSON<ValidationResultEntry[]>("registry/VALIDATION_RESULTS.json")
    : [];
  const matches = ledger.filter((r) => r.validator === validator && r.result === "FAIL");
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

interface KnownMistakeEntry { id: string; lesson: string }
interface ExistenceFile { known_mistakes?: { entries?: KnownMistakeEntry[] } }

function findKnowledgeLesson(rootCause: string | null): string | null {
  if (!rootCause) return null;
  const existence = readJSON<ExistenceFile>("registry/existence.json");
  const q = rootCause.toLowerCase();
  const match = (existence.known_mistakes?.entries ?? []).find((km) =>
    JSON.stringify(km).toLowerCase().includes(q.slice(0, 40))
  );
  return match ? `[${match.id}] ${match.lesson}` : null;
}

// Dev Loop Pipeline gate (owner, 2026-08-05): reads the REAL, already-written
// dev_loop_check_results / dev_loop_registry_proposals tables (written by
// scripts/impact-analyzer.ts off scripts/watch-registry.ts's evidence) — does
// not recompute impact here. Blocks on: the latest verdict for any path being
// 'fail', or any registry proposal still 'pending' (unapproved). If Supabase
// env vars are missing (e.g. a CI runner not yet configured with them), this
// missing required variables are themselves a blocked condition and are
// reported; the gate must not silently pass while Dev Loop evidence is absent.
async function checkDevLoopGate(): Promise<{ blocked: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    reasons.push("Required Supabase environment values are missing; Dev Loop evidence gate cannot be evaluated");
    return { blocked: true, reasons };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: results, error: resultsError } = await db
    .from("dev_loop_check_results")
    .select("path, result, reason, checked_at")
    .order("checked_at", { ascending: false })
    .limit(200);
  // อ่านไม่ได้ = ไม่มีหลักฐาน (ไม่ใช่ "ไม่มีปัญหา"): URL/คีย์ผิด, เน็ตขาด, หรือ
  // RLS ปฏิเสธ — ทั้งหมดต้องบล็อก ไม่ใช่เงียบผ่านด้วย `results ?? []`
  if (resultsError) {
    reasons.push(`Dev Loop evidence unreadable (dev_loop_check_results): ${resultsError.message}`);
    return { blocked: true, reasons };
  }

  const latestPerPath = new Map<string, { result: string; reason: string }>();
  for (const row of results ?? []) {
    if (!latestPerPath.has(row.path)) latestPerPath.set(row.path, { result: row.result, reason: row.reason });
  }
  for (const [path, verdict] of latestPerPath) {
    if (verdict.result === "fail") reasons.push(`Impact Analyzer FAIL: ${path} — ${verdict.reason}`);
  }

  const { data: pending, error: pendingError } = await db.from("dev_loop_registry_proposals").select("path, target_registry").eq("status", "pending");
  if (pendingError) {
    reasons.push(`Dev Loop evidence unreadable (dev_loop_registry_proposals): ${pendingError.message}`);
    return { blocked: true, reasons };
  }
  for (const p of pending ?? []) {
    reasons.push(`Unapproved registry proposal pending: ${p.path} -> ${p.target_registry} (needs Owner approval on the dashboard)`);
  }

  return { blocked: reasons.length > 0, reasons };
}

/**
 * Core chain wiring (P7): the gate must know WHAT release it is about to allow,
 * otherwise DEPLOYMENT_GATE and VERSION_RELEASE are disconnected (the previous
 * gate never read package.json or registry/CURRENT_STATE.json at all). This
 * reads the release artifacts that already exist — no new registry, no new
 * version file:
 *   - package.json            : the machine-readable version (must be semver)
 *   - registry/CURRENT_STATE.json : the owner-owned release state pointer
 *   - registry/CHANGELOG.json : the release ledger the pointer must be in
 * Hard blocks only on missing/invalid release evidence. A stale pointer
 * (CURRENT_STATE behind the newest CHANGELOG entry) is reported as a WARNING
 * with the owner action, because re-numbering a release is an owner decision —
 * the gate never rewrites ledger IDs.
 */
function checkReleaseBaseline(): { blocked: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];

  let version = "";
  try {
    version = String(readJSON<{ version?: string }>("package.json").version ?? "");
  } catch {
    version = "";
  }
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    reasons.push(`package.json version is missing or not semver: "${version}"`);
  }

  let state: { change_id?: string; status?: string } | null = null;
  try {
    state = readJSON<{ change_id?: string; status?: string }>("registry/CURRENT_STATE.json");
  } catch {
    state = null;
  }
  if (!state) {
    reasons.push("registry/CURRENT_STATE.json is unreadable — the release state pointer is required to deploy");
    return { blocked: reasons.length > 0, reasons, warnings };
  }
  if (state.status !== "READY") {
    reasons.push(`registry/CURRENT_STATE.json status is "${state.status}" — only a READY release state may deploy`);
  }

  let changeIds: string[] = [];
  try {
    changeIds = (readJSON<{ change_id?: string }[]>("registry/CHANGELOG.json") ?? [])
      .map((entry) => String(entry.change_id ?? ""))
      .filter((id) => id.length > 0);
  } catch {
    changeIds = [];
  }
  if (changeIds.length === 0) {
    reasons.push("registry/CHANGELOG.json has no change entries — the release ledger is empty");
  } else {
    if (state.change_id && !changeIds.includes(state.change_id)) {
      reasons.push(`release pointer ${state.change_id} is not recorded in registry/CHANGELOG.json`);
    }
    const newest = [...changeIds].sort().at(-1) ?? "";
    if (state.change_id && newest && newest > state.change_id) {
      warnings.push(
        `CURRENT_STATE.change_id (${state.change_id}) is behind the newest CHANGELOG entry (${newest}) — the release pointer needs an owner update`
      );
    }
  }

  return { blocked: reasons.length > 0, reasons, warnings };
}

async function main() {
  console.log("=== DNA OS Deploy Gate ===\n");
  console.log("Running real governance checks (scripts/governance.sh) — not simulated.\n");

  let governanceFailed = false;
  try {
    execSync("bash scripts/governance.sh", { cwd: ROOT, stdio: "inherit" });
  } catch {
    governanceFailed = true;
  }

  const health = readJSON<{ checks: Record<string, number> }>("DNA_OS_HEALTH.json");
  const failedKeys = Object.entries(health.checks).filter(([, v]) => v === 0).map(([k]) => k);

  const devLoop = await checkDevLoopGate();
  const release = checkReleaseBaseline();

  const problemCauses = [
    ...failedKeys.map((key) => `${CHECK_KEY_TO_VALIDATOR[key]?.validator ?? key} failed`),
    ...devLoop.reasons,
    ...release.reasons,
  ];
  if (problemCauses.length > 0) {
    const report = buildDevLoopProblemReport({
      source: "scripts/deploy-gate.ts",
      severity: "critical",
      checkName: "DNA OS Deploy Gate",
      cause: problemCauses.join("; ").slice(0, 1800),
      evidenceRefs: ["registry/VALIDATION_RESULTS.json", "public.dev_loop_check_results", "public.dev_loop_registry_proposals"],
      affectedFiles: failedKeys.map((key) => CHECK_KEY_TO_VALIDATOR[key]?.module ?? key),
      recommendedOwnerAction: "ตรวจหลักฐานใน Governance UI แล้วให้ Owner ตัดสินใจแก้ไข/อนุมัติ/ปฏิเสธตามขั้นตอน ห้ามระบบแก้หรืออนุมัติเอง",
    });
    const persisted = await persistDevLoopProblemReport(report, { db: await getDb() });
    console.log(`[deploy-gate] problem report ${persisted.deduplicated ? "deduplicated" : "recorded"}: ${report.report_id}`);
    console.log(`[deploy-gate] owner alert payload: ${report.owner_alert.spoken_summary}`);
  } else {
    const resolved = await resolvePersistedDevLoopProblem({ db: await getDb() });
    if (resolved) console.log(`[deploy-gate] resolved problem report: ${resolved.report_id}`);
  }

  console.log("\n" + "=".repeat(60));

  if (failedKeys.length === 0 && !devLoop.blocked && !release.blocked) {
    console.log("Deploy Gate: PASS");
    console.log("Status\n  READY");
    for (const warning of release.warnings) console.log(`  WARN  ${warning}`);
    process.exit(0);
  }

  if (release.warnings.length > 0) {
    for (const warning of release.warnings) console.log(`  WARN  ${warning}`);
  }

  if (release.blocked) {
    console.log(`Deploy Blocked — Release Baseline (VERSION_RELEASE)\n`);
    for (const reason of release.reasons) console.log(`  - ${reason}`);
    console.log(`\nRequired Action`);
    console.log(`  - Fix the release artifacts (package.json version / registry/CURRENT_STATE.json / registry/CHANGELOG.json) — all owner-owned`);
    console.log(`\nStatus\n  NOT READY\n`);
    console.log("-".repeat(60));
  }

  if (devLoop.blocked) {
    console.log(`Deploy Blocked — Dev Loop Pipeline\n`);
    for (const reason of devLoop.reasons) console.log(`  - ${reason}`);
    console.log(`\nRequired Action`);
    console.log(`  - Fix the failing path(s) and let the watcher re-check them, or approve/reject the pending registry proposal(s) on the dashboard`);
    console.log(`\nStatus\n  NOT READY\n`);
    console.log("-".repeat(60));
  }

  if (failedKeys.length === 0) process.exit(1);

  console.log(`Deploy Blocked — Governance\n`);
  for (const key of failedKeys) {
    const info = CHECK_KEY_TO_VALIDATOR[key];
    if (!info) continue;
    const result = latestMatchingResult(info.validator);
    const rootCause = result?.root_cause
      ?? (result?.evidence ? `ยังไม่มีการวินิจฉัย root cause อย่างเป็นทางการ — แต่มี evidence จริงที่ capture ไว้: ${result.evidence.slice(0, 300)}` : "ยังไม่มีการวินิจฉัย root cause จริงสำหรับความล้มเหลวนี้ — รัน scripts/record-validation.ts พร้อม --root-cause จริงก่อน");
    const suggestedFix = result?.suggested_fix ?? "ยังไม่มี suggested_fix ที่บันทึกไว้ — ต้องวิเคราะห์ก่อนดำเนินการแก้ไข";
    const lesson = findKnowledgeLesson(result?.root_cause ?? null);

    console.log(`Reason`);
    console.log(`  ${info.validator} failed`);
    console.log(`\nLocation`);
    console.log(`  ${info.module} (${result?.command ?? "command not captured"})`);
    console.log(`\nRoot Cause`);
    console.log(`  ${rootCause}`);
    console.log(`\nRequired Action`);
    console.log(`  - ${suggestedFix}`);
    console.log(`  - Revalidate (npm run deploy-gate)`);
    if (lesson) console.log(`\nKnown from Runtime Memory\n  ${lesson}`);
    console.log(`\nStatus\n  NOT READY\n`);
    console.log("-".repeat(60));

    // First real Runtime Mapping consumer (registry/KNOWLEDGE_RUNTIME_MAPPING.md,
    // owner, 2026-07-18). Best-effort, never blocks the gate — recordKnowledgeEntry
    // never throws (see services/knowledge/client.ts). Silent today: the
    // `knowledge` schema (Storage Adapter) has not been applied to production
    // yet, so this always no-ops until it is — that's expected, not a bug.
    const knowledge = await recordKnowledgeEntry({
      code: `INC-${new Date().toISOString().slice(0, 10)}-${key}`,
      entry_type: "incident",
      title: `Deploy Gate blocked: ${info.validator} failed`,
      summary: `${info.validator} failed during a real deploy-gate run — root cause: ${rootCause.slice(0, 200)}`,
      detail: `Required action: ${suggestedFix}`,
      source: "production",
      confidence: "verified",
      domains: ["infrastructure", "architecture"],
      runtime_actionable: false,
      ai_actionable: true,
      human_actionable: true,
      created_by: "deploy-gate.ts",
      metadata: { check_key: key, validator: info.validator, command: result?.command ?? null },
    });
    if (knowledge.ok) {
      console.log(`(recorded as Knowledge Entry ${knowledge.id})`);
    }
  }

  process.exit(1);
}

main();
