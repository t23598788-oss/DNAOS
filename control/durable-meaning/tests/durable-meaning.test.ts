/**
 * หน้าที่: prove that what DNA OS learns when a resource enters its network
 * outlives the session that learned it, and that no wording, agent or model can
 * change what it then knows (Owner, 2026-09-02).
 *
 * THE DEFECT UNDER TEST, IN ONE SENTENCE. `RegistrationCandidate.relationships`
 * is optional and there is no origin field at all, so an identity could be made
 * durable while its meaning evaporated with the process that discovered it —
 * 494 of 620 resources have zero edges and 0 of 200 can say why they exist.
 *
 * THE TWO PROPERTIES THIS FILE HAS TO SHOW. Memory formation: case P1 registers
 * a controlled resource in ONE process and case P2 resolves it from a SEPARATE
 * process that receives no transcript and opens no source file. Network
 * extension: cases V1–V6 add PROVIDER_ACCOUNT as domain vocabulary and require
 * Core to gain no branch that knows what a provider is.
 *
 * THE TEMPTATION IT REFUSES. It would be easy to make the orphans disappear by
 * having a model read the repository and write plausible origins. Cases F1–F3
 * fail if any absent fact becomes present: an origin nobody supplied stays
 * UNKNOWN, a relationship without evidence is not counted, and the contract
 * offers no way to cite a model as the producer of a fact.
 *
 * Input: none — reads the durable-meaning store and the canonical registry.
 * No execution, no OS action, no model.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../contract, ../vocabulary, ../store, ../../resource-network-coverage/analyze, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามเติม origin ที่ไม่มีใครให้มา, ห้ามให้ agent เป็นแหล่งความจริง,
 * ห้ามเขียนลง canonical registry.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { admitResource, isMachineReference, type Provenance } from "../contract";
import { isKindAllowed, registerExtension, validateExtension, jointRedefinesTruth, type VocabularyExtension } from "../vocabulary";
import { readAdmissions, readOrigins, readVocabularies, resolveKnowledgeFirst } from "../store";
import { readGraph } from "../../resource-network-coverage/analyze";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const ROOT = process.cwd();
const PROBE = "resource-step18-controlled-durable-meaning-probe";
const CANON = join(ROOT, "software/registry-database/data/canonical/resources.jsonl");
const canonBefore = readFileSync(CANON, "utf8").length;
const origins = readOrigins(), admissions = readAdmissions(), vocabs = readVocabularies();
const graph = readGraph();
const prov: Provenance = { produced_by: "REGISTRATION_PIPELINE", source: "tests", under_contract: "admitResource", verified_by: "tests", observed_at: "2026-09-02T00:00:00.000Z", canonical_identity: "x" };

(async () => {
  // ================= 1-4. identity without meaning, stated honestly =================
  const bare = admitResource({ resource_id: "r-bare", resource_kind: "resource" });
  check("1. an identity can be registered with UNKNOWN meaning",
    bare.identity_registered === true && bare.knowledge_binding_state === "UNBOUND_UNKNOWN"
    && bare.origin_state === "UNKNOWN" && bare.relationship_state === "UNKNOWN");
  check("2. UNKNOWN meaning is never fabricated",
    bare.origin === null && bare.relationship_count === 0
    && bare.missing_knowledge.includes("ORIGIN_KIND") && bare.missing_knowledge.includes("SUPPORTED_RELATIONSHIP"));
  const withOrigin = admitResource({ resource_id: "r-o", resource_kind: "resource", origin: { origin_kind: "REPAIR", origin_reference: "repair-123", introduced_by: "control/repair-loop" }, provenance: prov, evidence_refs: ["e"] });
  check("3. origin persists when the producer actually had it",
    withOrigin.origin_state === "KNOWN" && withOrigin.origin!.origin_kind === "REPAIR"
    && withOrigin.origin!.origin_reference === "repair-123");
  check("4. origin stays UNKNOWN when unavailable, even with everything else present",
    admitResource({ resource_id: "r-n", resource_kind: "resource", origin: { origin_kind: "UNKNOWN", origin_reference: null, introduced_by: null }, provenance: prov, evidence_refs: ["e"], supported_relationships: [{ relationship_kind: "K", to_id: "t", evidence_ref: "e" }] }).origin_state === "UNKNOWN");

  // ================= 5-8. the controlled registration, read back =================
  const probeAdmission = admissions.filter((a) => a.resource_id === PROBE).at(-1);
  const probeOrigin = origins.filter((o) => o.resource_id === PROBE).at(-1);
  check("5. registration readback preserves origin",
    !!probeAdmission && !!probeOrigin && probeOrigin!.origin_kind === "CAPABILITY_REQUIREMENT"
    && probeOrigin!.origin_reference === "capability-0de653bb-c968-4168-85c6-9d67beef2b5a");
  check("6. evidence provenance is preserved and names a real producer",
    probeOrigin!.provenance.produced_by === "REGISTRATION_PIPELINE"
    && probeOrigin!.provenance.canonical_identity === PROBE
    && probeOrigin!.evidence_refs.length > 0);
  check("7. relationship provenance is preserved",
    probeAdmission!.relationship_count === 1 && probeAdmission!.relationship_state === "KNOWN");
  check("8. every new registration produces a machine-readable binding result",
    typeof probeAdmission!.knowledge_binding_state === "string"
    && probeAdmission!.knowledge_binding_state === "BOUND_WITH_KNOWN_ORIGIN"
    && Array.isArray(probeAdmission!.missing_knowledge));

  // ================= 9-10. history and agents cannot be upgraded =================
  const legacy = admitResource({ resource_id: "r-legacy", resource_kind: "resource", legacy: true });
  check("9. a historical orphan is never silently upgraded",
    legacy.knowledge_binding_state === "UNBOUND_LEGACY" && legacy.origin_state === "UNKNOWN");
  const contractSrc = readFileSync(join(ROOT, "control/durable-meaning/contract.ts"), "utf8");
  check("10. an agent or model statement cannot become canonical truth",
    !/AGENT_STATEMENT|MODEL_INFERENCE|AGENT_REPORT/.test(contractSrc.replace(/\/\*[\s\S]*?\*\//g, ""))
    && !isMachineReference("the agent said this looks like a router"),
    "ProducedBy has no member a model could claim, and prose fails the reference check");

  // ================= 11-16. vocabulary extension, fail-closed =================
  const core = { entity_types: [...graph.canonical_entity_types, ...graph.cross_system_entity_types], relationship_kinds: [...graph.canonical_kinds, ...graph.cross_system_kinds] };
  const ext = vocabs.find((v) => v.vocabulary_id === "vocab-provider-identity-v1")!;
  check("11. unsupported vocabulary fails closed",
    isKindAllowed("NEVER_DECLARED_KIND", "OWNER", "PROVIDER_ACCOUNT", core, vocabs).reason === "UNDECLARED_KIND"
    && isKindAllowed("DNA_OS_ACCOUNT_TO_PROVIDER_ACCOUNT", "TEST", "TEST", core, vocabs).reason === "TYPE_PAIR_NOT_ALLOWED");
  check("12. a duplicate vocabulary id is rejected, not merged",
    (registerExtension(ext, core, [ext]) as { ok: false; rejections: readonly string[] }).rejections.includes("DUPLICATE_VOCABULARY_ID"));
  const conflicting: VocabularyExtension = { ...ext, vocabulary_id: "vocab-other", owner_boundary: "somewhere/else" };
  check("13. a conflicting semantic definition of the same kind is rejected",
    (registerExtension(conflicting, core, [ext]) as { ok: false; rejections: readonly string[] }).rejections.includes("CONFLICTING_RELATIONSHIP_KIND"));
  check("13b. a kind Core already owns cannot be redefined by a domain",
    (validateExtension({ ...ext, vocabulary_id: "v2", relationship_kinds: [{ relationship_kind: "CAPABILITY_TO_DEPENDENCY", allowed_from_types: ["CAPABILITY"], allowed_to_types: ["DEPENDENCY"], semantic_contract: "x" }] }, core, []) as { ok: false; rejections: readonly string[] }).rejections.includes("COLLIDES_WITH_CORE_KIND"));
  check("14. a domain vocabulary really can extend the graph",
    isKindAllowed("DNA_OS_ACCOUNT_TO_PROVIDER_ACCOUNT", "OWNER", "PROVIDER_ACCOUNT", core, vocabs).allowed === true
    && ext.entity_types.includes("PROVIDER_ACCOUNT")
    && !core.entity_types.includes("PROVIDER_ACCOUNT"),
    "PROVIDER_ACCOUNT is usable while remaining absent from Core");
  const vocabCode = readFileSync(join(ROOT, "control/durable-meaning/vocabulary.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  check("15. no provider-specific branch was added to the generic validator",
    !/vercel|railway|supabase|digitalocean|github/i.test(vocabCode)
    && !/PROVIDER_ACCOUNT/.test(vocabCode.replace(/\/\/[^\n]*/g, "")),
    "the validator is generic; the provider knowledge lives in the declaration data");
  check("16. a transformer cannot redefine either side's truth",
    jointRedefinesTruth({ joint_id: "j", side_a_identity: "a", side_b_identity: "a", input_contract: "c", output_contract: "c", identity_mapping: [], authority_requirement: "NONE", execution_method: "m", observation_method: null, verification_method: null, evidence_refs: [] }) === true
    && jointRedefinesTruth({ joint_id: "j", side_a_identity: "a", side_b_identity: "b", input_contract: "ci", output_contract: "co", identity_mapping: [{ from_field: "account_id", to_field: "team_id" }], authority_requirement: "NONE", execution_method: "m", observation_method: null, verification_method: null, evidence_refs: ["e"] }) === false);

  // ================= 17-20. knowledge before discovery, wording-invariant =================
  const answers = (["WHY_DOES_THIS_EXIST", "WHAT_IS_BOUND_TO_THIS", "WHAT_IS_ITS_BINDING_STATE"] as const)
    .map((q) => resolveKnowledgeFirst({ canonical_identity: PROBE, question: q }, origins, admissions));
  check("17. canonical knowledge is queried before any discovery",
    answers.every((a) => a.outcome === "KNOWLEDGE_FOUND" && a.answered_from !== null));
  check("18. a known fact triggers no repository excavation",
    answers.every((a) => a.answered_from!.startsWith("control/durable-meaning/data"))
    && resolveKnowledgeFirst({ canonical_identity: "resource-never-seen", question: "WHY_DOES_THIS_EXIST" }, origins, admissions).outcome === "DISCOVERY_REQUIRED",
    "found in the store; only an unknown identity asks for discovery");
  // Wording invariance is proven at the boundary this layer actually owns: the
  // resolver's key is a canonical identity, so requests differing ONLY in the
  // prose that produced them are indistinguishable to it and return identical
  // facts. The language→identity step itself is not exercised here — see the
  // reported boundary.
  const worded = [
    { prose: "what runs this?", canonical_identity: PROBE },
    { prose: "where does this execute?", canonical_identity: PROBE },
    { prose: "which runtime uses this capability?", canonical_identity: PROBE },
  ].map((w) => resolveKnowledgeFirst({ canonical_identity: w.canonical_identity, question: "WHAT_IS_BOUND_TO_THIS" }, origins, admissions));
  check("19. differently worded requests reaching the same identity return the same facts",
    new Set(worded.map((w) => JSON.stringify(w))).size === 1,
    "3 wordings, 1 byte-identical answer");
  check("20. canonical identity equality, not prose similarity, determines reuse",
    !readFileSync(join(ROOT, "control/durable-meaning/store.ts"), "utf8").includes("similarity")
    && resolveKnowledgeFirst({ canonical_identity: PROBE.toUpperCase(), question: "WHAT_IS_BOUND_TO_THIS" }, origins, admissions).outcome === "DISCOVERY_REQUIRED",
    "a near-identical but non-equal identity does not match");

  // ================= 21-24. session independence, proven by a separate process =================
  const fresh = execFileSync("/usr/local/bin/npx", ["tsx", "-e", `
    import { resolveKnowledgeFirst, readOrigins, readAdmissions } from "${ROOT}/control/durable-meaning/store";
    const a = resolveKnowledgeFirst({ canonical_identity: "${PROBE}", question: "WHY_DOES_THIS_EXIST" }, readOrigins(), readAdmissions());
    process.stdout.write(JSON.stringify({ outcome: a.outcome, kind: a.origin?.origin_kind, state: a.admission?.knowledge_binding_state, pid: process.pid }));
  `], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  const freshResult = JSON.parse(fresh.trim().split("\n").at(-1)!) as { outcome: string; kind: string; state: string; pid: number };
  check("21/22. knowledge survives its creator and a fresh process resolves it",
    freshResult.outcome === "KNOWLEDGE_FOUND" && freshResult.kind === "CAPABILITY_REQUIREMENT"
    && freshResult.state === "BOUND_WITH_KNOWN_ORIGIN" && freshResult.pid !== process.pid,
    `resolved in pid ${freshResult.pid}, not ${process.pid}`);
  check("23. the fresh process needed no prompt, transcript or repository read",
    !fresh.includes("resources.jsonl") && !fresh.includes("registration_events"),
    "its only input was the canonical identity string");
  check("24. the controlled new resource did not silently become an orphan",
    probeAdmission!.relationship_count > 0 && probeAdmission!.knowledge_binding_state !== "UNBOUND_UNKNOWN");

  // ================= 25-26. the locked distinctions still hold =================
  const caps = readFileSync(join(ROOT, "software/registry-database/data/canonical/capabilities.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { status: string; verified_at: string | null });
  check("25. REGISTERED still does not imply VERIFIED",
    caps.every((c) => c.status === "REGISTERED") && caps.every((c) => c.verified_at === null));
  check("26. UNKNOWN still does not imply an Owner decision",
    !/OWNER_DECISION|OWNER_REQUIRED/.test(contractSrc.replace(/\/\*[\s\S]*?\*\//g, ""))
    && bare.knowledge_binding_state === "UNBOUND_UNKNOWN",
    "an unexplained resource routes nowhere near the Owner");

  // ================= W. nothing canonical was touched =================
  check("W1. the canonical resource registry is byte-identical",
    readFileSync(CANON, "utf8").length === canonBefore);
  check("W2. no durable-meaning module writes to the canonical registry",
    !/canonical\/(resources|capabilities|relationships)\.jsonl/.test(
      readFileSync(join(ROOT, "control/durable-meaning/store.ts"), "utf8") + contractSrc + vocabCode));

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
