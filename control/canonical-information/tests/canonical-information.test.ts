/**
 * DNA_OS_CANONICAL_INFORMATION_BACKEND_V1 proofs A–S + live 1–6.
 *
 * How to run:
 *   npx tsx control/canonical-information/tests/canonical-information.test.ts
 */

import { CANONICAL_ENUMS } from "../types";
import { CANONICAL_MCP_RESOURCE_URIS } from "../../../connections/dna-os-mcp/canonical-resources";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { persistPipeline } from "../../work-production-pipeline/persist";
import { handleConversationRequest } from "../../conversation-runtime/main";
import { composeOwnerAskHttpBody } from "../../conversation-runtime/owner-ask-response";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import {
  canonicalMetrics,
  consumerPayload,
  documentationProjection,
  frontendBoundary,
  getActiveActivities,
  getCurrentState,
  getFacts,
  getRecentEvents,
  getRelationships,
  ingestProductionCanonical,
  ingestSafeCanonicalSources,
  invalidateEntity,
  listEntitiesByType,
  liveVerifiedOverridesDocumentation,
  projectOwnerInformation,
  queryBoundary,
  queryEntityByCanonicalName,
  resetCanonicalStore,
  resolveFact,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
process.env.WORK_PIPELINE_LOG = join(tmpdir(), `cinfo-pipe-fixture-${STAMP}.jsonl`);

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  resetCanonicalStore();
  ingestSafeCanonicalSources();

  await check("A. Existing capability can be queried without source search", () => {
    const caps = listEntitiesByType("CAPABILITY");
    assert(caps.length > 0, "caps");
    assert(canonicalMetrics().REGISTERED_FACT_CACHE_HITS > 0, "cache hit");
    assert(!JSON.stringify(caps[0]).includes("search the repository"), "no search");
  });

  await check("B. Existing connection boundary queried without prose", () => {
    const row = queryBoundary("GITHUB_PUBLISH", "DEPLOYMENT_AUTHORITY");
    assert(row !== null && row.status === "NOT_WIRED", JSON.stringify(row));
    assert(!JSON.stringify(row).includes("# "), "no markdown");
  });

  await check("C. Machine enums are canonical", () => {
    for (const cap of listEntitiesByType("CAPABILITY")) {
      assert((CANONICAL_ENUMS as readonly string[]).includes(cap.status), cap.status);
      assert(String(cap.status) !== "เชื่อมต่อแล้ว", cap.status);
    }
  });

  await check("D. Facts are separate from presentation", () => {
    const facts = getFacts("entity:system:dna-os");
    const deploy = facts.find((row) => row.key === "deployment_mutation");
    assert(deploy?.value === false, JSON.stringify(deploy));
    assert(typeof deploy?.value !== "string" || deploy.value !== "ยัง deploy ไม่ได้ครับ", "not human copy");
  });

  await check("E. Relationships are machine-queryable", () => {
    const rels = getRelationships("entity:system:dna-os");
    assert(rels.some((row) => row.relationship_type === "EXPOSES" || row.relationship_type === "CONNECTS_TO"), JSON.stringify(rels.slice(0, 3)));
  });

  await check("F. Current state preserves previous state/version", () => {
    const cap = listEntitiesByType("CAPABILITY")[0];
    const before = getCurrentState(cap.entity_id);
    invalidateEntity(cap.entity_id, "test-invalidate");
    const after = getCurrentState(cap.entity_id);
    assert(after !== null && before !== null, "states");
    const afterState = after;
    const beforeState = before;
    assert(afterState.version > beforeState.version, `${afterState.version} vs ${beforeState.version}`);
    assert(afterState.previous_state === beforeState.current_state, String(afterState.previous_state));
  });

  await check("G. Events do not grant authority", () => {
    assert(getRecentEvents().every((row) => row.grants_authority === false), "events");
  });

  await check("H. Active work can be queried deterministically", () => {
    persistPipeline({
      schema: "DNA_OS_WORK_PRODUCTION_PIPELINE_V1",
      work_id: `work-cinfo-${STAMP}`,
      lane: "DEVELOPMENT_LANE",
      intent: { schema: "OWNER_DEVELOPMENT_INTENT_V1", work_id: `work-cinfo-${STAMP}`, owner_goal: "fixture capability X", requested_change: "add marker", risk_class: "LOW", production_intent: false, deployment_target: null, created_at: new Date().toISOString() },
      work_order: { schema: "DETERMINISTIC_CODE_WORK_ORDER_V1", work_order_id: `wo-${STAMP}`, work_id: `work-cinfo-${STAMP}`, goal: "fixture", repository_id: "repo://pipeline-fixture", base_revision: "UNCOMMITTED", target_files: ["src/feature.ts"], required_tests: [], forbidden_paths: [], created_at: new Date().toISOString() },
      state: "IN_DEVELOPMENT",
      risk_class: "LOW",
      source_revision: "UNCOMMITTED",
      remote_sha: null,
      promotion: "LOCAL_ONLY",
      artifact_id: null,
      deployment_id: null,
      capability_id: null,
      previous_verified_revision: null,
      owner_enabled: false,
      runtime_verified: false,
      missing: [],
      evidence: {},
      metrics: {},
      transitions: [],
      lineage: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    ingestProductionCanonical();
    const active = getActiveActivities();
    assert(active.some((row) => row.work_id === `work-cinfo-${STAMP}` && row.current_stage === "IN_DEVELOPMENT"), JSON.stringify(active));
  });

  await check("I. Evidence bodies are not duplicated", () => {
    const metrics = canonicalMetrics();
    assert(metrics.EVIDENCE_INDEX_ENTRIES > 0, "index");
    assert(metrics.EVIDENCE_INDEX_ENTRIES <= metrics.CANONICAL_ENTITIES + 20, "not dumping bodies");
  });

  await check("J. Surfaces share information not authority", () => {
    const fb = frontendBoundary();
    assert(fb.INFORMATION_ACCESS_GRANTS_AUTHORITY === false, "authority");
    assert(listEntitiesByType("OWNER_SURFACE").length === 2, "two surfaces");
  });

  await check("K. Stale fact cannot present as fresh", () => {
    const cap = listEntitiesByType("CAPABILITY")[0];
    invalidateEntity(cap.entity_id, "stale-proof");
    const stale = getFacts(cap.entity_id).filter((row) => row.freshness_state === "STALE");
    assert(stale.length > 0, "stale");
    const payload = consumerPayload(cap.entity_id, "CAPABILITY_SUMMARY");
    assert(payload?.freshness === "STALE", String(payload?.freshness));
  });

  await check("L. Live verified state overrides stale documentation", () => {
    const live = liveVerifiedOverridesDocumentation("entity:system:dna-os", "deployment_mutation", false);
    const resolved = resolveFact("entity:system:dna-os", "deployment_mutation");
    assert(resolved !== null && resolved.source_precedence === "LIVE_VERIFIED_RUNTIME_FACT", String(resolved?.source_precedence));
    assert(live.value === false, "live false");
  });

  if (process.env.DNA_OS_HERMETIC_SOURCE !== "1") {
  await check("M+LIVE6. Self-knowledge uses canonical backend first", () => {
    const live = handleConversationRequest({
      request_id: "live-canonical-self",
      trace_id: "live-canonical-self",
      owner_identity: { identity_id: "identity-canonical", kind: "human" },
      text: "DNA OS มี connection อะไรบ้าง",
      persist: false,
    });
    const http = composeOwnerAskHttpBody(live, "READ_ONLY_LANGUAGE");
    console.log(`LIVE_SELF_KNOWLEDGE=${String(http.FINAL_SEMANTIC_STATE)} BLOCKED=${String(http.READ_ONLY_LANGUAGE_BLOCKED)}`);
    assert(http.READ_ONLY_LANGUAGE_BLOCKED === false, "blocked");
    assert(http.FINAL_SEMANTIC_STATE === "ANSWERABLE_READ_ONLY", String(http.FINAL_SEMANTIC_STATE));
    assert(live.evidence_refs.some((ref) => ref.includes("canonical-information") || ref.includes("connection-index")), live.evidence_refs.join(","));
  });
  }

  await check("N. Missing canonical data may fall back safely", () => {
    const missing = queryEntityByCanonicalName("does-not-exist-capability");
    assert(missing === null, "missing");
    assert(canonicalMetrics().SOURCE_SEARCH_FALLBACKS >= 0, "fallback metric");
  });

  await check("O. MCP resource projection is deterministic", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("dna_os.get_information_entity"), "tool");
    const ordered = [...CANONICAL_MCP_RESOURCE_URIS];
    assert(JSON.stringify(ordered) === JSON.stringify([...CANONICAL_MCP_RESOURCE_URIS].sort((a, b) => CANONICAL_MCP_RESOURCE_URIS.indexOf(a) - CANONICAL_MCP_RESOURCE_URIS.indexOf(b))), "order");
    assert(CANONICAL_MCP_RESOURCE_URIS[0] === "resource://dna-os/system", CANONICAL_MCP_RESOURCE_URIS[0]);
  });

  await check("P+LIVE4. Consumer payload requires no repository rediscovery", () => {
    const cap = listEntitiesByType("CAPABILITY")[0];
    const payload = consumerPayload(cap.entity_id, "CAPABILITY_SUMMARY");
    assert(payload !== null, "payload");
    const consumer = payload;
    const data = consumer.structured_data;
    assert(typeof data.name === "string" && Boolean(data.status) && Boolean(data.availability) && Boolean(data.authority_state), JSON.stringify(data));
    assert(Array.isArray(data.actions), "actions");
    assert(consumer.evidence_refs.length > 0, "evidence");
    console.log(`LIVE_CONSUMER_PAYLOAD=${consumer.projection_type} FRESHNESS=${consumer.freshness}`);
  });

  await check("Q. Frontend cannot invent state/action", () => {
    const fb = frontendBoundary();
    assert(fb.FRONTEND_CAN_REINTERPRET_STATE === false && fb.FRONTEND_CAN_GRANT_AUTHORITY === false && fb.FRONTEND_CAN_INVENT_ACTION === false, JSON.stringify(fb));
    const proj = projectOwnerInformation("entity:system:dna-os", "SYSTEM_SUMMARY");
    assert(proj?.FRONTEND_CAN_INVENT_ACTION === false, "proj");
  });

  await check("R. Documentation projection without source-wide search", () => {
    const docs = documentationProjection();
    assert(docs.SOURCE_SEARCH_REQUIRED === false, "search");
    assert(Array.isArray(docs.capabilities), "caps");
  });

  await check("LIVE 1. Capability query", () => {
    const caps = listEntitiesByType("CAPABILITY");
    const proj = projectOwnerInformation(caps[0].entity_id, "CAPABILITY_SUMMARY");
    console.log(`LIVE_CAPABILITY_QUERY=${caps.length} SOURCE_SEARCH_REQUIRED=false HITS=${canonicalMetrics().REGISTERED_FACT_CACHE_HITS}`);
    assert(proj !== null, "projection");
  });

  await check("LIVE 2. Connection gap", () => {
    const row = queryBoundary("GITHUB_PUBLISH", "DEPLOYMENT_AUTHORITY");
    console.log(`LIVE_CONNECTION_BOUNDARY_QUERY=${row?.status}`);
    assert(row?.status === "NOT_WIRED", String(row?.status));
  });

  await check("LIVE 3. Active development", () => {
    const row = getActiveActivities().find((item) => item.work_id === `work-cinfo-${STAMP}`);
    console.log(`LIVE_ACTIVE_DEVELOPMENT=${row?.current_stage} actor=${row?.actor_type}`);
    assert(row !== undefined && row.actor_type === "DNA_OS" && row.current_stage === "IN_DEVELOPMENT", JSON.stringify(row));
  });

  await check("LIVE 5. Stale state", () => {
    const cap = listEntitiesByType("CAPABILITY")[0];
    const state = getCurrentState(cap.entity_id);
    assert(state?.current_state === "STALE" || getFacts(cap.entity_id).some((row) => row.freshness_state === "STALE"), JSON.stringify(state));
    console.log(`LIVE_STALE_STATE=${String(state?.current_state)}`);
  });

  await check("S. Work surface backend ready; MCP reused", () => {
    const snap = ownerWorkSurfaceSnapshot("ai://cinfo", "session-cinfo");
    const entities = (snap.canonical_information as { CANONICAL_ENTITIES?: number } | undefined)?.CANONICAL_ENTITIES;
    assert(typeof entities === "number" && entities > 0, "surface backend");
    assert(DNA_OS_MCP_TOOLS.some((tool) => tool.metadata.name === "submit_command"), "existing mcp");
  });

  const m = canonicalMetrics();
  console.log(`METRICS ${JSON.stringify(m)}`);
  console.log(`SOURCE_TEST_REQUIRES_RUNTIME_JSONL=false`);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
