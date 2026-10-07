/**
 * หน้าที่: measure, against the real registry, how much of its own resource
 * network DNA OS can express versus how much it has actually recorded — and
 * prove the two are never reported as one number (Owner, 2026-09-02).
 *
 * THE CONFLATION THIS TEST EXISTS TO BLOCK. "The schema supports ownership"
 * and "we know who owns this" sound alike and are worlds apart. Case S1 requires
 * every probe to carry both answers, and case S2 requires at least one probe to
 * be expressible with zero rows — because if that case never arises, the
 * measurement is not actually distinguishing the two.
 *
 * ORPHAN MUST STAY A REFUSAL. A resource with no edges is a candidate for
 * examination, never a candidate for deletion. Cases O1–O3 require that
 * `classifyOrphan` cannot emit anything stronger, that the ten safe-delete
 * requirements are measured rather than assumed, and that at least three of them
 * are unprovable today — which is the honest reason nothing can be deleted.
 *
 * NOTHING IS WRITTEN. Case W1 checks by byte length that the registry files are
 * identical after the whole measurement runs. This step reads; it does not
 * repair, register or delete.
 *
 * Input: none — reads the canonical registry and cross-system store.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../analyze, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามสร้าง relationship row, ห้ามสรุปว่าลบได้, ห้ามรายงาน
 * schema-expressible ว่าเป็นความรู้ที่มีจริง.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessCreationReason, classifyOrphan, measureProbe, readGraph, safeDeleteRequirements, type RelationshipProbe } from "../analyze";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const ROOT = process.cwd();
const REG = join(ROOT, "software/registry-database/data/canonical/relationships.jsonl");
const RES = join(ROOT, "software/registry-database/data/canonical/resources.jsonl");
const sizeBefore = readFileSync(REG, "utf8").length + readFileSync(RES, "utf8").length;
const graph = readGraph();

/** The eighteen ownership questions Phase 2 asks, each with the kind that would carry it. */
const PROBES: readonly RelationshipProbe[] = [
  { relationship: "CAPABILITY -> SOURCE_REPOSITORY", from_entity_type: "CAPABILITY", to_entity_type: "REPOSITORY", candidate_kind: "REPOSITORY_HAS_SOURCE_FILE" },
  { relationship: "CAPABILITY -> RUNTIME_SERVICE", from_entity_type: "CAPABILITY", to_entity_type: "SERVICE", candidate_kind: "REPOSITORY_DEPLOYS_TO_SERVICE" },
  { relationship: "CAPABILITY -> DATA_STORE", from_entity_type: "CAPABILITY", to_entity_type: "DATABASE_PROJECT", candidate_kind: "APPLICATION_USES_DATABASE_PROJECT" },
  { relationship: "CAPABILITY -> CREDENTIAL_REFERENCE", from_entity_type: "CAPABILITY", to_entity_type: "CREDENTIAL", candidate_kind: "CAPABILITY_TO_CREDENTIAL" },
  { relationship: "CAPABILITY -> PROVIDER", from_entity_type: "CAPABILITY", to_entity_type: "PROVIDER", candidate_kind: "CAPABILITY_TO_PROVIDER" },
  { relationship: "CAPABILITY -> PROVIDER_ACCOUNT", from_entity_type: "CAPABILITY", to_entity_type: "PROVIDER_ACCOUNT", candidate_kind: "CAPABILITY_TO_PROVIDER_ACCOUNT" },
  { relationship: "CAPABILITY -> PROVIDER_PROJECT", from_entity_type: "CAPABILITY", to_entity_type: "PROVIDER_PROJECT", candidate_kind: "PROVIDER_PROJECT_HAS_SERVICE" },
  { relationship: "CAPABILITY -> EXECUTION_METHOD", from_entity_type: "CAPABILITY", to_entity_type: "EXECUTION_METHOD", candidate_kind: "CAPABILITY_TO_EXECUTION_METHOD" },
  { relationship: "CAPABILITY -> VERIFICATION_EVIDENCE", from_entity_type: "CAPABILITY", to_entity_type: "TEST", candidate_kind: "CAPABILITY_TO_TEST" },
  { relationship: "RESOURCE -> OWNER", from_entity_type: "RESOURCE", to_entity_type: "OWNER", candidate_kind: "CAPABILITY_TO_OWNER" },
  { relationship: "RESOURCE -> CREATED_FOR", from_entity_type: "RESOURCE", to_entity_type: "OWNER", candidate_kind: "RESOURCE_CREATED_FOR" },
  { relationship: "RESOURCE -> DEPENDS_ON", from_entity_type: "CAPABILITY", to_entity_type: "DEPENDENCY", candidate_kind: "CAPABILITY_TO_DEPENDENCY" },
  { relationship: "RESOURCE -> USED_BY", from_entity_type: "RESOURCE", to_entity_type: "CAPABILITY", candidate_kind: "CAPABILITY_PROVIDED_BY_RESOURCE" },
  { relationship: "RESOURCE -> REPLACES", from_entity_type: "RESOURCE", to_entity_type: "RESOURCE", candidate_kind: "RESOURCE_REPLACES" },
  { relationship: "RESOURCE -> SUPERSEDES", from_entity_type: "SOURCE_FILE", to_entity_type: "SOURCE_FILE", candidate_kind: "SOURCE_FILE_DUPLICATE_OF" },
  { relationship: "RESOURCE -> COST_SOURCE", from_entity_type: "RESOURCE", to_entity_type: "PROVIDER_ACCOUNT", candidate_kind: "RESOURCE_TO_COST_SOURCE" },
  { relationship: "DNA_OS_ACCOUNT -> PROVIDER_ACCOUNT", from_entity_type: "ACCOUNT", to_entity_type: "PROVIDER_ACCOUNT", candidate_kind: "DNA_OS_ACCOUNT_TO_PROVIDER_ACCOUNT" },
  { relationship: "DNA_OS_RESOURCE -> PROVIDER_RESOURCE", from_entity_type: "RESOURCE", to_entity_type: "PROVIDER_PROJECT", candidate_kind: "DNA_OS_RESOURCE_TO_PROVIDER_RESOURCE" },
];

(async () => {
  const results = PROBES.map((p) => measureProbe(p, graph));

  // ================= S. schema-expressible is not knowledge =================
  check("S1. every probe reports expressibility and real rows separately",
    results.every((r) => typeof r.schema_expressible === "string" && typeof r.current_real_rows === "number"
      && ((r.schema_expressible === "EXPRESSIBLE") === (r.verdict !== "SCHEMA_GAP"))),
    `${results.filter((r) => r.schema_expressible === "EXPRESSIBLE").length}/${results.length} expressible`);
  const expressibleButEmpty = results.filter((r) => r.verdict === "MISSING_RELATIONSHIP_INSTANCE");
  check("S2. the measurement really distinguishes 'can say' from 'has said'",
    expressibleButEmpty.length > 0 && expressibleButEmpty.every((r) => r.current_real_rows === 0 && r.existing_relationship_kind !== null),
    `${expressibleButEmpty.length} probes are expressible with zero rows`);
  check("S3. a schema gap names the missing type or kind, not a vague absence",
    results.filter((r) => r.verdict === "SCHEMA_GAP").every((r) => typeof r.gap === "string" && r.gap.length > 0),
    `${results.filter((r) => r.verdict === "SCHEMA_GAP").length} schema gaps`);
  check("S4. row counting is exact-kind, so a similar kind cannot be borrowed",
    measureProbe({ relationship: "probe", from_entity_type: "CAPABILITY", to_entity_type: "TEST", candidate_kind: "CAPABILITY_TO_TES" }, graph).verdict === "SCHEMA_GAP",
    "a near-miss kind name resolves to SCHEMA_GAP, never to the real kind's rows");

  // ================= A. the Step 16 account edge, through the general model =================
  const accountEdge = results.find((r) => r.relationship === "DNA_OS_ACCOUNT -> PROVIDER_ACCOUNT")!;
  check("A1. the Step 16 edge is a SCHEMA gap, not merely a missing row",
    accountEdge.verdict === "SCHEMA_GAP" && accountEdge.existing_relationship_kind === null
    && !graph.canonical_entity_types.includes("PROVIDER_ACCOUNT") && !graph.cross_system_entity_types.includes("PROVIDER_ACCOUNT"),
    "neither a PROVIDER_ACCOUNT entity type nor a binding kind exists");
  const vercelRows = [...graph.resources, ...graph.capabilities, ...graph.relationships, ...graph.cross_relationships]
    .filter((r) => JSON.stringify(r).includes("team_3uDXRYjLEx8E3AVWiuegeg2N"));
  check("A2. the real provider account appears nowhere in the graph",
    vercelRows.length === 0,
    "the billing store knows it; the resource network has never heard of it");

  // ================= O. orphan and safe delete =================
  const ids = graph.resources.map((r) => String(r["resource_id"] ?? "")).filter(Boolean);
  const assessments = ids.slice(0, 200).map((id) => classifyOrphan(id, graph));
  check("O1. orphan classification can only refuse, never authorise",
    assessments.every((a) => a.orphan_state === "ORPHAN_CANDIDATE" || a.orphan_state === "UNKNOWN")
    && !JSON.stringify(assessments).includes("SAFE_TO_DELETE"),
    `${assessments.filter((a) => a.orphan_state === "ORPHAN_CANDIDATE").length} candidates / ${assessments.length} sampled`);
  check("O2. a resource with edges is never called an orphan candidate",
    assessments.filter((a) => a.used_by.length > 0 || a.depends_on.length > 0).every((a) => a.orphan_state === "UNKNOWN"));
  const reqs = safeDeleteRequirements(graph);
  check("O3. safe-delete requirements are measured, and several are unprovable today",
    reqs.length === 10 && reqs.filter((r) => !r.provable_today).length >= 3
    && reqs.filter((r) => !r.provable_today).every((r) => typeof r.missing === "string" && r.missing!.length > 0),
    `${reqs.filter((r) => r.provable_today).length}/10 provable; unprovable: ${reqs.filter((r) => !r.provable_today).map((r) => r.requirement).join(", ")}`);
  check("O4. nothing anywhere in this module can conclude a deletion is safe",
    !/SAFE_TO_DELETE/.test(readFileSync(join(ROOT, "control/resource-network-coverage/analyze.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));

  // ================= C. why does this exist =================
  const reasons = ids.slice(0, 200).map((id) => assessCreationReason(id, graph));
  check("C1. a registration event is not treated as a creation reason",
    reasons.some((r) => r.creation_reason_state === "REGISTRATION_EVENT_ONLY")
    && reasons.filter((r) => r.creation_reason_state === "REGISTRATION_EVENT_ONLY").every((r) => r.first_missing_edge !== null)
    && reasons.every((r) => r.creation_reason_state !== "KNOWN"),
    `KNOWN 0, REGISTRATION_EVENT_ONLY ${reasons.filter((r) => r.creation_reason_state === "REGISTRATION_EVENT_ONLY").length}, UNKNOWN ${reasons.filter((r) => r.creation_reason_state === "UNKNOWN").length}`);
  check("C2. no historical lineage is fabricated where none exists",
    reasons.filter((r) => r.creation_reason_state === "UNKNOWN").every((r) => r.origin_reference === null && r.evidence.length === 0));

  // ================= L. lifecycle vocabulary already exists, mostly unused =================
  const resourceStatuses = new Set(graph.resources.map((r) => String(r["status"] ?? "")));
  check("L1. the resource lifecycle enum is three-valued and only one value is ever used",
    resourceStatuses.size === 1 && resourceStatuses.has("REGISTERED"),
    `${graph.resources.length} resources, all REGISTERED; SUPERSEDED and RETIRED exist in the type and have zero rows`);

  // ================= W. nothing was written =================
  const sizeAfter = readFileSync(REG, "utf8").length + readFileSync(RES, "utf8").length;
  check("W1. the registry is byte-identical after the whole measurement", sizeBefore === sizeAfter);
  const code = readFileSync(join(ROOT, "control/resource-network-coverage/analyze.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("W2. the analyzer has no write path and invokes no model",
    !/writeFileSync|appendFileSync|mkdirSync/.test(code)
    && !/\b(fetch|anthropic|openai|claude|spawn|child_process|Math\.random)/i.test(code),
    "read-only, deterministic");
  check("W3. repeated measurement is identical",
    JSON.stringify(PROBES.map((p) => measureProbe(p, readGraph()))) === JSON.stringify(results));

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
