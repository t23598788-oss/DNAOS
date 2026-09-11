/**
 * หน้าที่: give the already-proven APPLICATION_01_SOFTWARE_DELIVERY a canonical
 * identity in the cross-system store, and link it to identities that already
 * exist elsewhere — never to copies of them.
 *
 * IDENTITY + RELATIONSHIPS + STATE, NOT EVIDENCE. The application row carries
 * pointers (a task id, an execution evidence id, three commit shas); the
 * evidence bodies stay where they already live. The eleven capabilities are
 * resolved out of the existing registry by canonical name, so this file cannot
 * invent one.
 *
 * SCOPE. Only the APPLICATION entity row is created. REPOSITORY, VERSION, WORK
 * and EXECUTION appear as edge endpoints using the ids their own existing
 * stores already assign (software/repository-registry/, git, agent-gateway
 * tasks/evidence) — no second universe of entities is created for them.
 *
 * Input: none.  Output: printed result + rows in data/cross-system/.
 * Dependency ที่อนุญาต: ../registry-database/cross-system-store,
 * ../registry-database/contract, ../registry-database/adapters/persistent-file-store.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนลง data/canonical/, ห้ามยุบสาม revision เป็นอันเดียว.
 * Usage: npx tsx software/capability-registrar/register-application-01.ts
 */
import { getEntity, linkEntities, registerEntity, resolveApplication } from "../registry-database/cross-system-store";
import { findCapability } from "../registry-database/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import {
  ensureRuntimeEndpointsLoaded,
  joinEndpointAddress,
  resolveRuntimeEndpoint,
} from "../../control/runtime-endpoint-registry/contract";

const store = createPersistentFileStore();

export const APPLICATION_01_ID = "application://dna-os/software-delivery";
const REPOSITORY_ID = "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-";
const WORK_ID = "task-app01-jm-server-20260901T072113Z";
const EXECUTION_ID = "execution-1df10e60-7638-4283-9967-f3fe028194b0";

/** Oldest first. Three separate deliveries, kept as three — the final one is the last, not the only one. */
const REVISION_LINEAGE = [
  "33e0a8171da7e8e1a294952d6fc24c82affcfc1c",
  "a3348862127b16511d3525fa83bd1fa2008a6490",
  "e2206a50794562ba7f33e287c77bf508b05c1d5c",
];
const FINAL_REVISION = REVISION_LINEAGE[REVISION_LINEAGE.length - 1]!;

function jointMonitorHealthEvidence(): string {
  ensureRuntimeEndpointsLoaded();
  const resolved = resolveRuntimeEndpoint({ query: "endpoint://joint-monitor/public", purpose: "observe" });
  const health = resolved.ok ? joinEndpointAddress(resolved.endpoint, "/health") : "UNRESOLVED";
  return `runtime_health:${health} revision=${FINAL_REVISION} revision_source=RAILWAY_BUILD`;
}

const CAPABILITY_NAMES = [
  "source-execution", "github-source-executor", "railway-connector", "runtime-revision-reporting",
  "ui-render-verification", "ui-render-screenshots", "work-result-ingress", "target-resolution",
  "permission-policy-resolution", "admission", "evidence-store",
];

const EVIDENCE_POINTERS = [
  EXECUTION_ID,
  WORK_ID,
  `github_revision:${FINAL_REVISION}`,
  `railway_deployment:joint-monitor@${FINAL_REVISION} SUCCESS`,
  jointMonitorHealthEvidence(),
  "control/ui-render-verification/data/render-evidence.jsonl execution_id=task-app01-jm-server-20260901T072113Z verdict=VERIFIED",
];

function main(): number {
  const entity = registerEntity({
    entity_id: APPLICATION_01_ID,
    entity_type: "APPLICATION",
    canonical_name: "APPLICATION_01_SOFTWARE_DELIVERY",
    state: "END_TO_END_PROVEN",
    source_authority: "DNA_OS_REGISTRY",
    evidence_refs: EVIDENCE_POINTERS,
  });
  console.log("APPLICATION:", entity.status, entity.reason ?? "", entity.entity?.entity_id ?? "");
  if (!entity.entity) return 1;

  let linked = 0;
  let reused = 0;
  let rejected = 0;
  const link = (input: Parameters<typeof linkEntities>[0], label: string): void => {
    const r = linkEntities(input);
    if (r.status === "REGISTERED") linked += 1;
    else if (r.status === "REUSED") reused += 1;
    else { rejected += 1; console.log(`  REJECTED ${label}: ${r.reason}`); }
  };

  for (const name of CAPABILITY_NAMES) {
    const capability = findCapability({ canonical_name: name } as never, store) as { capability_id?: string } | null;
    if (!capability?.capability_id) { console.log(`  CAPABILITY_NOT_FOUND ${name}`); rejected += 1; continue; }
    link({
      from_type: "APPLICATION", from_id: APPLICATION_01_ID,
      to_type: "CAPABILITY", to_id: capability.capability_id,
      relationship_kind: "APPLICATION_USES_CAPABILITY",
      source_authority: "DNA_OS_REGISTRY", evidence_refs: [EXECUTION_ID, WORK_ID],
    }, `APPLICATION_USES_CAPABILITY ${name}`);
  }

  link({
    from_type: "APPLICATION", from_id: APPLICATION_01_ID,
    to_type: "REPOSITORY", to_id: REPOSITORY_ID,
    relationship_kind: "APPLICATION_HAS_REPOSITORY",
    source_authority: "GITHUB", evidence_refs: [`github_revision:${FINAL_REVISION}`],
  }, "APPLICATION_HAS_REPOSITORY");

  // Lineage: three edges, one per delivery. Collapsing them would erase history.
  for (const revision of REVISION_LINEAGE) {
    link({
      from_type: "REPOSITORY", from_id: REPOSITORY_ID,
      to_type: "VERSION", to_id: revision,
      relationship_kind: "REPOSITORY_HAS_VERSION",
      source_authority: "GITHUB", evidence_refs: [`github_revision:${revision}`],
      scope: revision === FINAL_REVISION ? "FINAL" : "LINEAGE",
    }, `REPOSITORY_HAS_VERSION ${revision.slice(0, 12)}`);
  }

  const sourceExecution = findCapability({ canonical_name: "source-execution" } as never, store) as { capability_id?: string } | null;
  if (sourceExecution?.capability_id) {
    link({
      from_type: "WORK", from_id: WORK_ID,
      to_type: "CAPABILITY", to_id: sourceExecution.capability_id,
      relationship_kind: "WORK_TARGETS_CAPABILITY",
      source_authority: "DNA_OS_REGISTRY", evidence_refs: [EXECUTION_ID],
    }, "WORK_TARGETS_CAPABILITY");
  }

  link({
    from_type: "EXECUTION", from_id: EXECUTION_ID,
    to_type: "WORK", to_id: WORK_ID,
    relationship_kind: "EXECUTION_OF_WORK",
    source_authority: "DNA_OS_REGISTRY", evidence_refs: [`github_revision:${FINAL_REVISION}`],
  }, "EXECUTION_OF_WORK");

  console.log(`RELATIONSHIPS: registered=${linked} reused=${reused} rejected=${rejected}`);

  const resolved = resolveApplication(APPLICATION_01_ID);
  console.log("RESOLVED:", JSON.stringify({
    entity_id: resolved.entity?.entity_id,
    canonical_name: resolved.entity?.canonical_name,
    state: resolved.entity?.state,
    capabilities: resolved.capabilities.length,
    repositories: resolved.repositories.length,
    versions: resolved.versions.length,
    work: resolved.work.length,
    executions: resolved.executions.length,
  }));
  return rejected === 0 && getEntity(APPLICATION_01_ID) !== null ? 0 : 1;
}

process.exit(main());
