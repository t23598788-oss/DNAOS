import { createClient } from "@supabase/supabase-js";

const EVENT_TYPES = new Set([
  "work_started",
  "code_committed",
  "github_published",
  "github_main_merged",
  "github_ci_completed",
  "manual_checks_completed",
  "migration_applied",
  "migration_verified",
  "build_verified",
  "deployment_completed",
  "live_route_verified",
]);
const STATUSES = new Set(["passed", "failed", "blocked", "recorded"]);
const ENVIRONMENTS = new Set(["local", "development", "staging", "production"]);
const SOURCES = new Set(["codex", "github_actions", "supabase_cli", "operator"]);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required setting: ${name}`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function validateHash(name: string, value: string | null): void {
  if (value !== null && !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 hex digest`);
  }
}

async function main(): Promise<void> {
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const recordKey = process.env.DNAOS_RECORD_KEY?.trim() || "dnaos-platform";
  const eventKey = required("DNAOS_EVENT_KEY");
  const eventType = required("DNAOS_EVENT_TYPE");
  const rawStatus = required("DNAOS_EVENT_STATUS");
  const repository = required("DNAOS_REPOSITORY");
  const source = required("DNAOS_EVENT_SOURCE");
  const commitSha = optional("DNAOS_COMMIT_SHA")?.toLowerCase() ?? null;
  const migrationId = optional("DNAOS_MIGRATION_ID");
  const sqlSha256 = optional("DNAOS_SQL_SHA256")?.toLowerCase() ?? null;
  const evidenceSha256 = optional("DNAOS_EVIDENCE_SHA256")?.toLowerCase() ?? null;
  const environment = optional("DNAOS_ENVIRONMENT");
  const deploymentId = optional("DNAOS_DEPLOYMENT_ID");
  const occurredAt = optional("DNAOS_OCCURRED_AT") ?? new Date().toISOString();
  const branch = optional("DNAOS_BRANCH");
  const changeSetKey = optional("DNAOS_CHANGE_SET_KEY");
  const status = rawStatus === "success"
    ? "passed"
    : rawStatus === "failure"
      ? "failed"
      : rawStatus === "cancelled"
        ? "blocked"
        : rawStatus;

  if (!EVENT_TYPES.has(eventType)) throw new Error("Unsupported development event type");
  if (!STATUSES.has(status)) throw new Error("Unsupported development event status");
  if (!SOURCES.has(source)) throw new Error("Unsupported development event source");
  if (environment !== null && !ENVIRONMENTS.has(environment)) throw new Error("Unsupported environment");
  if (commitSha !== null && !/^[a-f0-9]{40}$/.test(commitSha)) throw new Error("Commit SHA must be a full 40-character Git SHA");
  if ((migrationId === null) !== (sqlSha256 === null)) throw new Error("Migration ID and SQL hash must be recorded together");
  if (migrationId !== null && !/^[0-9]{14}_[a-z0-9_]+$/.test(migrationId)) throw new Error("Migration ID format is invalid");
  validateHash("DNAOS_SQL_SHA256", sqlSha256);
  validateHash("DNAOS_EVIDENCE_SHA256", evidenceSha256);
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error("Occurred time must be a valid timestamp");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const event = {
    p_record_key: recordKey,
    p_event_key: eventKey,
    p_event_type: eventType,
    p_status: status,
    p_repository: repository,
    p_branch: branch,
    p_commit_sha: commitSha,
    p_migration_id: migrationId,
    p_sql_sha256: sqlSha256,
    p_environment: environment,
    p_deployment_id: deploymentId,
    p_evidence_sha256: evidenceSha256,
    p_source: source,
    p_occurred_at: new Date(occurredAt).toISOString(),
  };

  const { data, error } = await supabase.rpc("record_development_event", event);
  if (error || !data?.length) {
    throw new Error(`Development event was not recorded (${error?.code ?? "database error"})`);
  }

  if (changeSetKey) {
    const { error: linkError } = await supabase.rpc("link_development_event_to_change_set", {
      p_event_key: eventKey,
      p_change_set_key: changeSetKey,
    });
    if (linkError) throw new Error("Development event was saved but could not be linked to its DNA change set");
  }

  console.log(JSON.stringify({
    ok: true,
    record_key: recordKey,
    event_key: eventKey,
    event_type: eventType,
    status,
    change_set_key: changeSetKey,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Development event recording failed");
  process.exitCode = 1;
});
