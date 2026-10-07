/**
 * หน้าที่: the database gate. It answers whether a database object could be
 * removed — and its default answer is BLOCK.
 *
 * WHY THE DEFAULT IS BLOCK AND NOT "no reference found". Source code not
 * currently referencing a table is the weakest possible evidence that the table
 * is dead. A table is read by Edge Functions, by cron jobs, by webhooks, by
 * other tables' foreign keys, by whatever the Owner runs by hand, and by the
 * historical record itself. Absence of a grep hit is absence of a grep hit.
 * So every obligation below starts as `null` — UNPROVEN — and only a real
 * finding moves it to true or false. Any obligation left `null` is a BLOCK.
 *
 * THIS FOLDER CANNOT REACH THE OPERATIONAL DATABASE, BY DESIGN.
 * `connections/supabase/README.md` and the root boundary rule forbid a direct
 * database dependency between Infrastructure and Operational. So the gate does
 * NOT connect to Supabase. It reads the DECLARATIONS that the operational
 * repository keeps in git — migrations, Edge Functions, cron schedules — which
 * are facts about what the database is configured to do, and it says plainly
 * that live reader/writer activity is unproven from here. That is the honest
 * boundary: this gate can refuse, and it can never approve on its own.
 *
 * Input: a table/object name and the operational repo root.
 * Output: `assessDatabaseObject`.
 * Dependency ที่อนุญาต: ./types.ts, node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเชื่อมต่อฐานข้อมูลจริงจากไฟล์นี้.
 * - ห้ามเปลี่ยน default จาก BLOCK.
 * - ห้ามคืน verdict ที่อนุญาตให้ลบ record ทางการเงิน/เอกสาร.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSafetyDecision } from "./types";

/** Object-name markers that carry financial or document lineage. These can only ever produce BLOCK. */
const FINANCIAL_DOCUMENT_MARKERS = /(transaction|payment|invoice|receipt|billing|tax|debt|bank|ledger|clearinghouse|document|statement|fuel_price|payroll)/i;

function grepCount(pattern: string, dir: string): { count: number; files: string[] } {
  if (!existsSync(dir)) return { count: 0, files: [] };
  try {
    const out = execFileSync("/usr/bin/grep", ["-rlF", pattern, dir], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
    const files = out ? out.split("\n") : [];
    return { count: files.length, files };
  } catch {
    return { count: 0, files: [] };
  }
}

function grepRegexCount(pattern: string, dir: string): { count: number; files: string[] } {
  if (!existsSync(dir)) return { count: 0, files: [] };
  try {
    const out = execFileSync("/usr/bin/grep", ["-rlE", pattern, dir], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
    const files = out ? out.split("\n") : [];
    return { count: files.length, files };
  } catch {
    return { count: 0, files: [] };
  }
}

/**
 * Assess one database object. Returns BLOCK unless every obligation is
 * positively proven — which, from this side of the boundary, cannot happen for
 * live reader/writer activity. That is the point: this gate exists to stop a
 * removal, not to authorise one.
 */
export function assessDatabaseObject(objectName: string, operationalRepoRoot: string): DatabaseSafetyDecision {
  const unproven: string[] = [];
  const migrations = join(operationalRepoRoot, "supabase", "migrations");
  const functions = join(operationalRepoRoot, "supabase", "functions");

  // FOREIGN KEYS — a real declaration in the schema's own history.
  const fk = grepRegexCount(`REFERENCES[[:space:]]+(public\\.)?${objectName}\\b`, migrations);
  const noForeignKey = fk.count === 0;

  // EDGE FUNCTIONS — deployed code that names the object.
  const edge = grepCount(objectName, functions);
  const noEdgeFunction = edge.count === 0;

  // CRON — pg_cron schedules declared in migrations that name the object.
  const cronFiles = grepRegexCount("cron\\.schedule|pg_cron", migrations);
  const cronNaming = cronFiles.files.filter((f) => grepCount(objectName, f).count > 0);
  const noCron = cronNaming.length === 0;

  // WEBHOOKS — including LINE. An object touched by a webhook path is live by
  // definition, whatever the application source currently imports.
  const webhookFiles = grepRegexCount("webhook|line-webhook|messaging-api", functions);
  const webhookNaming = webhookFiles.files.filter((f) => grepCount(objectName, f).count > 0);
  const noWebhook = webhookNaming.length === 0;

  // FINANCIAL / DOCUMENT LINEAGE — name-based AND content-based, and either is enough to block.
  const financialByName = FINANCIAL_DOCUMENT_MARKERS.test(objectName);
  const financialFunctions = edge.files.filter((f) => FINANCIAL_DOCUMENT_MARKERS.test(f));
  const noFinancialLineage = !financialByName && financialFunctions.length === 0;

  // The obligations this side of the boundary genuinely cannot answer.
  unproven.push("no_active_reader: this repository may not query the operational database (root boundary rule), so live reads cannot be observed from here");
  unproven.push("no_active_writer: same boundary — live writes cannot be observed from here");
  unproven.push("no_historical_or_audit_requirement: no lifecycle policy in either repository declares a retention window for database objects");
  unproven.push("retention_permits_removal: no declared database retention policy exists to permit anything");
  unproven.push("backup_recovery_path_exists: no verified restore path for this object was found in either repository");

  const decision: DatabaseSafetyDecision = {
    object_reference: objectName,
    no_active_reader: null,
    no_active_writer: null,
    no_foreign_key_reference: noForeignKey,
    no_edge_function_dependency: noEdgeFunction,
    no_cron_dependency: noCron,
    no_webhook_dependency: noWebhook,
    no_financial_or_document_lineage: noFinancialLineage,
    no_historical_or_audit_requirement: null,
    retention_permits_removal: null,
    backup_recovery_path_exists: null,
    verdict: "BLOCK",
    reason: "",
    unproven,
  };

  // Reasons are ordered so the strongest one is reported, not the first one found.
  const blockers: string[] = [];
  if (!noFinancialLineage) {
    blockers.push(financialByName
      ? `"${objectName}" carries financial or document lineage by name — the Owner's rule is BLOCK unless an explicit lifecycle policy permits removal, and none exists`
      : `Edge Functions with financial or document responsibility reference it: ${financialFunctions.slice(0, 3).map((f) => f.split("/").slice(-2).join("/")).join(", ")}`);
  }
  if (!noWebhook) blockers.push(`a webhook path references it: ${webhookNaming.slice(0, 3).map((f) => f.split("/").slice(-2).join("/")).join(", ")}`);
  if (!noCron) blockers.push(`a cron schedule references it: ${cronNaming.slice(0, 3).map((f) => f.split("/").pop()).join(", ")}`);
  if (!noEdgeFunction) blockers.push(`${edge.count} Edge Function file(s) reference it`);
  if (!noForeignKey) blockers.push(`${fk.count} migration(s) declare a foreign key to it`);

  decision.reason = blockers.length > 0
    ? `BLOCK — ${blockers.join("; ")}`
    : `BLOCK — no dependency was found in the declarations this side can read, but ${unproven.length} obligation(s) remain unproven and an unproven obligation is never an approval: ${unproven.map((u) => u.split(":")[0]).join(", ")}`;

  return decision;
}
