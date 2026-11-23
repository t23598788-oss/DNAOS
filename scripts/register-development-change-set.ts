// DNA OS MODULE: Register one capability-sized DNA bundle, its Git-tracked files,
// per-file hashes, and company-scoped release-policy references in Supabase.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

type FileChange = {
  path: string;
  previous_path: string | null;
  commit_sha: string;
  change_kind: "added" | "modified" | "deleted" | "renamed";
  content_sha256: string | null;
};

const CATEGORIES = new Set([
  "database_schema",
  "business_formula",
  "business_policy",
  "application_api",
  "integration",
  "infrastructure",
  "authentication_email",
  "documentation",
]);
const TARGET_KINDS = new Set([
  "github_repository",
  "supabase_project",
  "cloudflare_worker",
  "production_company",
  "other",
]);
const ENVIRONMENTS = new Set(["local", "development", "staging", "production"]);
const OPERATIONS = new Set([
  "source_publish",
  "main_merge",
  "database_migration",
  "worker_deploy",
  "auth_template_update",
  "production_release",
]);
const CREDENTIAL_CLASSES = new Set([
  "read_only",
  "development_scoped_write",
  "staging_scoped_write",
  "production_release_scoped",
]);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required setting: ${name}`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function git(args: string[], encoding: "utf8"): string;
function git(args: string[], encoding: null): Buffer;
function git(args: string[], encoding: "utf8" | null): string | Buffer {
  return execFileSync("git", args, { encoding, maxBuffer: 20 * 1024 * 1024 });
}

function readChangeList(baseSha: string, commitSha: string): Array<{
  status: string;
  path: string;
  previousPath: string | null;
}> {
  const output = git(["diff", "--name-status", "-z", baseSha, commitSha, "--"], "utf8");
  const fields = output.split("\0").filter(Boolean);
  const changes: Array<{ status: string; path: string; previousPath: string | null }> = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (!previousPath || !path) throw new Error("Git returned an incomplete rename record");
      changes.push({ status, path, previousPath });
    } else {
      const path = fields[index++];
      if (!path) throw new Error("Git returned an incomplete file record");
      changes.push({ status, path, previousPath: null });
    }
  }
  return changes;
}

function buildManifest(baseSha: string, commitSha: string): FileChange[] {
  const changes = readChangeList(baseSha, commitSha);
  if (changes.length === 0) throw new Error("No changed files were found between the selected commits");

  return changes.map(({ status, path, previousPath }) => {
    const changeKind = status.startsWith("A")
      ? "added"
      : status.startsWith("D")
        ? "deleted"
        : status.startsWith("R") || status.startsWith("C")
          ? "renamed"
          : "modified";
    let contentSha256: string | null = null;
    if (changeKind !== "deleted") {
      const blob = git(["show", `${commitSha}:${path}`], null);
      contentSha256 = createHash("sha256").update(blob).digest("hex");
    }
    return {
      path,
      previous_path: previousPath,
      commit_sha: commitSha,
      change_kind: changeKind,
      content_sha256: contentSha256,
    };
  });
}

async function main(): Promise<void> {
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const recordKey = process.env.DNAOS_RECORD_KEY?.trim() || "dnaos-platform";
  const changeSetKey = required("DNAOS_CHANGE_SET_KEY");
  const category = required("DNAOS_CHANGE_SET_CATEGORY");
  const title = required("DNAOS_CHANGE_SET_TITLE");
  const summary = required("DNAOS_CHANGE_SET_SUMMARY");
  const repository = required("DNAOS_REPOSITORY");
  const operation = required("DNAOS_OPERATION");
  const targetKind = required("DNAOS_TARGET_KIND");
  const baseSha = required("DNAOS_BASE_SHA").toLowerCase();
  const commitSha = required("DNAOS_COMMIT_SHA").toLowerCase();
  const targetEnvironment = optional("DNAOS_TARGET_ENVIRONMENT");
  const environmentId = optional("DNAOS_ENVIRONMENT_ID");
  const targetRef = optional("DNAOS_TARGET_REF");
  const targetCompanyId = optional("DNAOS_TARGET_COMPANY_ID");
  const targetOrganizationId = optional("DNAOS_TARGET_ORGANIZATION_ID");
  const policyRef = optional("DNAOS_POLICY_REF");
  const policyVersion = optional("DNAOS_POLICY_VERSION");
  const policySha256 = optional("DNAOS_POLICY_SHA256")?.toLowerCase() ?? null;
  const credentialClass = optional("DNAOS_CREDENTIAL_CLASS");
  const sourceStartedAt = required("DNAOS_WORK_STARTED_AT");

  if (!CATEGORIES.has(category)) throw new Error("Unsupported DNA change-set category");
  if (!TARGET_KINDS.has(targetKind)) throw new Error("Unsupported DNA target kind");
  if (!OPERATIONS.has(operation)) throw new Error("Unsupported operation");
  if (credentialClass !== null && !CREDENTIAL_CLASSES.has(credentialClass)) {
    throw new Error("Unsupported credential class");
  }
  if (targetEnvironment !== null && !ENVIRONMENTS.has(targetEnvironment)) {
    throw new Error("Unsupported target environment");
  }
  if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error("Base and commit references must be full Git SHAs");
  }
  if (policySha256 !== null && !/^[0-9a-f]{64}$/.test(policySha256)) {
    throw new Error("DNAOS_POLICY_SHA256 must be a lowercase SHA-256 digest");
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (targetCompanyId !== null && !uuidPattern.test(targetCompanyId)) {
    throw new Error("DNAOS_TARGET_COMPANY_ID must reference an existing company UUID");
  }
  if (targetOrganizationId !== null && !uuidPattern.test(targetOrganizationId)) {
    throw new Error("DNAOS_TARGET_ORGANIZATION_ID must reference an existing organization UUID");
  }
  if (Number.isNaN(Date.parse(sourceStartedAt))) throw new Error("Work start time must be an ISO timestamp");
  if (["staging", "production"].includes(targetEnvironment ?? "") && !environmentId) {
    throw new Error("Staging and Production bundles require an exact environment ID");
  }
  if (targetEnvironment === "production" && (
    !targetRef || !targetCompanyId || !targetOrganizationId || !policyRef || !policyVersion || !policySha256
    || credentialClass !== "production_release_scoped"
  )) {
    throw new Error("Production bundles require exact target, company and organization IDs, hashed policy reference, and scoped release credential class");
  }

  const headSha = git(["rev-parse", "HEAD"], "utf8").trim().toLowerCase();
  if (headSha !== commitSha) throw new Error("DNAOS_COMMIT_SHA must match the checked-out HEAD");

  const files = buildManifest(baseSha, commitSha);
  const manifestSha256 = createHash("sha256")
    .update(JSON.stringify([...files].sort((a, b) => `${a.commit_sha}:${a.path}`.localeCompare(`${b.commit_sha}:${b.path}`))))
    .digest("hex");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("register_development_change_set", {
    p_record_key: recordKey,
    p_change_set_key: changeSetKey,
    p_category: category,
    p_title: title,
    p_summary: summary,
    p_repository: repository,
    p_operation: operation,
    p_target_kind: targetKind,
    p_target_environment: targetEnvironment,
    p_environment_id: environmentId,
    p_target_ref: targetRef,
    p_target_company_id: targetCompanyId,
    p_target_organization_id: targetOrganizationId,
    p_policy_ref: policyRef,
    p_policy_version: policyVersion,
    p_policy_sha256: policySha256,
    p_credential_class: credentialClass,
    p_manifest_sha256: manifestSha256,
    p_source_started_at: new Date(sourceStartedAt).toISOString(),
    p_files: files,
  });
  if (error || !data?.length) throw new Error("DNA change set was not recorded");
  const row = data[0] as { change_set_id: string; created: boolean };

  const eventKeys = (optional("DNAOS_LINK_EVENT_KEYS") ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  for (const eventKey of eventKeys) {
    const { error: linkError } = await supabase.rpc("link_development_event_to_change_set", {
      p_event_key: eventKey,
      p_change_set_key: changeSetKey,
    });
    if (linkError) throw new Error("An evidence event could not be linked to the DNA change set");
  }

  console.log(JSON.stringify({
    ok: true,
    change_set_id: row.change_set_id,
    change_set_key: changeSetKey,
    category,
    file_count: files.length,
    manifest_sha256: manifestSha256,
    created: row.created,
    linked_event_count: eventKeys.length,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "DNA change-set recording failed");
  process.exitCode = 1;
});
