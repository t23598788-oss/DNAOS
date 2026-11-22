#!/usr/bin/env npx tsx
/** Append one idempotent, DNA-linked lifecycle event to the existing internal ledger. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type EventType = "source_committed" | "test_completed" | "build_completed" | "migration_applied" | "deployment_verified" | "rollback_recorded";
type Environment = "development" | "staging" | "production";
type Outcome = "pass" | "fail" | "conflict" | "unverified" | "not_applicable";

const EVENT_TYPES = new Set<EventType>([
  "source_committed", "test_completed", "build_completed", "migration_applied", "deployment_verified", "rollback_recorded",
]);
const ENVIRONMENTS = new Set<Environment>(["development", "staging", "production"]);
const OUTCOMES = new Set<Outcome>(["pass", "fail", "conflict", "unverified", "not_applicable"]);
const DB_EVENT_TYPE: Record<EventType, Exclude<EventType, "build_completed">> = {
  source_committed: "source_committed",
  test_completed: "test_completed",
  build_completed: "test_completed",
  migration_applied: "migration_applied",
  deployment_verified: "deployment_verified",
  rollback_recorded: "rollback_recorded",
};

function argsFrom(argv: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

const values = argsFrom(process.argv.slice(2));
const one = (key: string, fallback?: string) => values.get(key)?.[0] ?? fallback;
const many = (key: string) => values.get(key) ?? [];

function required(key: string): string {
  const value = one(key);
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function validate() {
  const eventType = required("event-type") as EventType;
  const environment = required("environment") as Environment;
  const outcome = required("outcome") as Outcome;
  const dnaId = required("dna-id");
  const eventKey = required("event-key");
  const repository = required("repository");
  const actorRef = required("actor-ref");
  const actorKind = required("actor-kind");
  if (!EVENT_TYPES.has(eventType)) throw new Error("Unsupported --event-type");
  if (!ENVIRONMENTS.has(environment)) throw new Error("Unsupported --environment");
  if (!OUTCOMES.has(outcome)) throw new Error("Unsupported --outcome");
  if (!/^DNA-CAP-[0-9]{6}$/.test(dnaId)) throw new Error("Invalid --dna-id");
  if (!/^[a-zA-Z0-9._:/-]{1,240}$/.test(eventKey)) throw new Error("Invalid --event-key");
  if (!eventKey.startsWith(`${dnaId}/`)) throw new Error("--event-key must begin with its registered DNA ID");
  if (actorKind !== "human" && actorKind !== "automation") throw new Error("Unsupported --actor-kind");
  const registry = JSON.parse(readFileSync(join(process.cwd(), "registry/DNA_ID_REGISTRY.json"), "utf8")) as {
    identities?: Array<{ dna_id: string; status: string; repository: string }>;
  };
  if (!registry.identities?.some((entry) => entry.dna_id === dnaId && entry.status === "active" && entry.repository === required("repository"))) {
    throw new Error("DNA ID is not active for this repository in registry/DNA_ID_REGISTRY.json");
  }

  const commitSha = one("commit-sha");
  if (commitSha && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commitSha)) throw new Error("Invalid --commit-sha");
  const migrationVersion = one("migration-version");
  const migrationSha256 = one("migration-sha256");
  if (Boolean(migrationVersion) !== Boolean(migrationSha256)) throw new Error("--migration-version and --migration-sha256 must be provided together");
  if (migrationSha256 && !/^[0-9a-f]{64}$/.test(migrationSha256)) throw new Error("Invalid --migration-sha256");
  const evidenceSha256 = one("evidence-sha256");
  if (evidenceSha256 && !/^[0-9a-f]{64}$/.test(evidenceSha256)) throw new Error("Invalid --evidence-sha256");
  if ((eventType === "migration_applied" || eventType === "deployment_verified") && environment === "production") {
    if (!one("approver-ref") || !one("approved-at")) throw new Error("Production migration/deployment evidence requires --approver-ref and --approved-at");
    if (Number.isNaN(Date.parse(one("approved-at")!))) throw new Error("Invalid --approved-at");
  }

  const refs = [
    `dna_id=${dnaId}`,
    `event_kind=${eventType}`,
    ...(one("predecessor-event-key") ? [`predecessor_event_key=${one("predecessor-event-key")}`] : []),
    ...(one("workflow-run-id") ? [`workflow_run_id=${one("workflow-run-id")}`] : []),
    ...(one("deployment-id") ? [`deployment_id=${one("deployment-id")}`] : []),
    ...(evidenceSha256 ? [`evidence_sha256=${evidenceSha256}`] : []),
    ...many("evidence-ref"),
  ];
  const jwtLike = /^[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}$/;
  if (refs.some((ref) => ref.length > 512 || /(?:password|secret|service[_ -]?role|api[_ -]?key|bearer\s)/i.test(ref) || jwtLike.test(ref))) {
    throw new Error("Evidence references must be short identifiers or links and must not contain credentials");
  }

  return {
    event_key: eventKey,
    event_type: DB_EVENT_TYPE[eventType],
    repository,
    branch: one("branch") ?? null,
    commit_sha: commitSha ?? null,
    migration_version: migrationVersion ?? null,
    migration_sha256: migrationSha256 ?? null,
    environment,
    outcome,
    actor_kind: actorKind,
    actor_ref: actorRef,
    approver_ref: one("approver-ref") ?? null,
    approved_at: one("approved-at") ?? null,
    evidence_refs: refs,
  };
}

async function main() {
  const row = validate();
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase ledger credentials are not configured");

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const endpoint = `${baseUrl}/rest/v1`;
  const getRows = async (table: string, query: string) => {
    const response = await fetch(`${endpoint}/${table}?${query}`, { headers });
    if (!response.ok) throw new Error(`Ledger read failed (${response.status})`);
    return await response.json() as Array<Record<string, unknown>>;
  };

  const existing = await getRows("development_work_ledger", `event_key=eq.${encodeURIComponent(row.event_key)}&select=id,event_key,event_type,outcome,commit_sha,migration_version,migration_sha256,evidence_refs`);
  if (existing.length > 1) throw new Error("Duplicate event_key found in the ledger");
  if (existing.length === 1) {
    const prior = existing[0];
    const same = prior.event_type === row.event_type && prior.outcome === row.outcome &&
      prior.commit_sha === row.commit_sha && prior.migration_version === row.migration_version &&
      prior.migration_sha256 === row.migration_sha256 && JSON.stringify(prior.evidence_refs) === JSON.stringify(row.evidence_refs);
    if (!same) throw new Error("event_key already exists with different evidence; refusing to overwrite");
    process.stdout.write(`RECORDED ${prior.id} (idempotent retry)\n`);
    return;
  }

  const predecessorKey = one("predecessor-event-key");
  if (predecessorKey) {
    const parents = await getRows("development_work_ledger", `event_key=eq.${encodeURIComponent(predecessorKey)}&select=id,event_key,evidence_refs`);
    const parentRefs = Array.isArray(parents[0]?.evidence_refs) ? parents[0].evidence_refs as string[] : [];
    if (parents.length !== 1 || !parentRefs.includes(`dna_id=${one("dna-id")}`)) {
      throw new Error("Predecessor event is missing, ambiguous, or belongs to another DNA ID");
    }
  }

  const response = await fetch(`${endpoint}/development_work_ledger`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Ledger insert failed (${response.status})`);
  const inserted = await response.json() as Array<{ id: string }>;
  if (inserted.length !== 1) throw new Error("Ledger insert returned no unique event record");
  process.stdout.write(`RECORDED ${inserted[0].id}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown lifecycle ledger error";
  console.error(`[lifecycle-ledger] ${message}`);
  process.exitCode = 1;
});
