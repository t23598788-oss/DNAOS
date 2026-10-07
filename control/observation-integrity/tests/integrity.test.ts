/**
 * หน้าที่: prove that the exact measurement pattern which produced a false
 * data-loss incident now resolves to "measurements disagree" and never to
 * "the file was truncated" (Owner, 2026-09-02).
 *
 * THE RECORDED PATTERN, REPLAYED. On 2026-09-02 a high-level read returned 0
 * bytes, without error, for `tools/acceptance-verifier.ts` while `stat` said
 * 9,918 and a positioned descriptor read returned all 9,918 bytes of correct
 * content. Case R1 feeds those three observations back in verbatim. The required
 * output is CONFLICTING with `accepted_fact: null`; cases R2–R4 fail if
 * FILE_TRUNCATED, DATA_LOSS or OWNER_DECISION_REQUIRED can be derived from it.
 *
 * WHY NO ARBITRATION RULE EXISTS. It would be easy — and wrong — to prefer the
 * reading that matches `stat`, or the larger one, or the method that is usually
 * right. Each is a heuristic that would have resolved this incident correctly by
 * luck and will resolve the next one incorrectly with equal confidence. Case A1
 * asserts the contract contains no such preference at source level.
 *
 * REPEATING A METHOD IS NOT A SECOND OPINION. Case I1 gives two identical
 * high-level reads and requires INSUFFICIENT, not CONSISTENT: a method that is
 * wrong is usually consistently wrong, which is precisely how the incident
 * survived several confirmations.
 *
 * Input: none — synthetic observation sets plus read-only reads of real files.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../contract, ../verified-read, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มกฎเลือกผู้ชนะเมื่อผลขัดแย้ง, ห้ามยอมรับ 0 ไบต์
 * เพราะไม่มี exception.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFLICT_IMPLIES, deriveIntegrity, readOutcomeFrom, type Observation } from "../contract";
import { verifiedReadFile, verifiedReadJsonl } from "../verified-read";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const ROOT = process.cwd();
const at = "2026-09-02T02:30:00.000Z";
const obs = (method: Observation["method"], bytes: number | null, hashv: string | null = null, error: string | null = null): Observation =>
  ({ method, result_bytes: bytes, error, content_hash: hashv, observed_at: at });

(async () => {
  // ================= R. the recorded incident, replayed verbatim =================
  const incident = deriveIntegrity("control/computer-use-executor/tools/acceptance-verifier.ts", [
    obs("METADATA_STAT", 9918),
    obs("HIGH_LEVEL_READ", 0, "e3b0c44298fc1c14"),
    obs("POSITIONED_DESCRIPTOR_READ", 9918, "a1b2c3d4e5f60718"),
  ]);
  check("R1. the recorded pattern resolves to CONFLICTING, by its own name",
    incident.consistency_state === "CONFLICTING"
    && incident.reason === "METADATA_NONZERO_BUT_CONTENT_READ_ZERO"
    && incident.accepted_fact === null,
    "stat 9918 / high-level 0 / positioned 9918");
  check("R2. FILE_TRUNCATED cannot be derived from it",
    CONFLICT_IMPLIES.FILE_TRUNCATED === false && CONFLICT_IMPLIES.FILE_EMPTY === false
    && !/TRUNCAT|EMPTY_FILE|DATA_LOSS/i.test(JSON.stringify(incident)));
  check("R3. DATA_LOSS cannot be derived from it",
    CONFLICT_IMPLIES.DATA_LOSS === false && CONFLICT_IMPLIES.SOURCE_MISSING === false
    && CONFLICT_IMPLIES.CAPABILITY_BROKEN === false);
  check("R4. a technical conflict never reaches the Owner",
    CONFLICT_IMPLIES.OWNER_DECISION_REQUIRED === false
    && !/OWNER/i.test(JSON.stringify(incident)),
    "conflict is software's problem to resolve");
  check("R5. the conflicting observation is preserved, not discarded",
    incident.observations.length === 3
    && incident.observations.some((o) => o.result_bytes === 0)
    && incident.observations.some((o) => o.result_bytes === 9918),
    "both readings survive in the record");

  // ================= A. no arbitration, no plausibility =================
  const src = readFileSync(join(ROOT, "control/observation-integrity/contract.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("A1. the contract contains no rule that picks a winner",
    !/Math\.max|Math\.min|\.sort\(|prefer|mostLikely|bestGuess/i.test(src)
    && !/\b(fetch|anthropic|openai|claude|Math\.random)\b/i.test(src),
    "no largest-wins, no matches-stat-wins, no model");
  check("A2. every conflict yields a null fact, whatever the shape",
    [
      deriveIntegrity("t", [obs("HIGH_LEVEL_READ", 10, "h1"), obs("POSITIONED_DESCRIPTOR_READ", 20, "h2")]),
      deriveIntegrity("t", [obs("HIGH_LEVEL_READ", 10, "h1"), obs("POSITIONED_DESCRIPTOR_READ", 10, "DIFFERENT")]),
      deriveIntegrity("t", [obs("METADATA_STAT", 99), obs("HIGH_LEVEL_READ", 10, "h"), obs("POSITIONED_DESCRIPTOR_READ", 10, "h")]),
    ].every((i) => i.consistency_state === "CONFLICTING" && i.accepted_fact === null));

  // ================= I. independence and insufficiency =================
  check("I1. repeating one method is not a second opinion",
    deriveIntegrity("t", [obs("HIGH_LEVEL_READ", 0, "h"), obs("HIGH_LEVEL_READ", 0, "h")]).consistency_state === "INSUFFICIENT",
    "a consistently wrong method cannot corroborate itself");
  check("I2. all methods erroring is not a fact either",
    deriveIntegrity("t", [obs("HIGH_LEVEL_READ", null, null, "EIO"), obs("POSITIONED_DESCRIPTOR_READ", null, null, "EIO")]).reason === "ALL_METHODS_ERRORED");
  check("I3. agreement across two independent methods is accepted",
    ((): boolean => {
      const i = deriveIntegrity("t", [obs("METADATA_STAT", 100), obs("HIGH_LEVEL_READ", 100, "h"), obs("POSITIONED_DESCRIPTOR_READ", 100, "h")]);
      return i.consistency_state === "CONSISTENT" && i.accepted_fact === 100 && i.reason === "ALL_METHODS_AGREE";
    })());
  check("I4. zero bytes is accepted only when genuinely corroborated",
    deriveIntegrity("t", [obs("METADATA_STAT", 0), obs("HIGH_LEVEL_READ", 0, "e"), obs("POSITIONED_DESCRIPTOR_READ", 0, "e")]).consistency_state === "CONSISTENT",
    "a truly empty file is CONSISTENT — the rule is corroboration, not suspicion of zero");
  check("I5. a target changing mid-read is reported, not resolved",
    deriveIntegrity("t", [obs("HIGH_LEVEL_READ", 10, "h"), obs("POSITIONED_DESCRIPTOR_READ", 10, "h")], [], true).reason === "TARGET_CHANGED_DURING_OBSERVATION");

  // ================= O. outcomes withhold content on conflict =================
  check("O1. a conflict yields no content to act on",
    readOutcomeFrom(incident, "some content") === "READ_CONFLICT"
    && verifiedReadFile(join(ROOT, "control/observation-integrity/contract.ts")).outcome === "READ_SUCCEEDED");
  const missing = verifiedReadFile(join(ROOT, "control/observation-integrity/does-not-exist.ts"));
  check("O2. a missing file is READ_FAILED, never READ_SUCCEEDED with empty content",
    missing.outcome === "READ_FAILED" && missing.content === null);
  const vr = readFileSync(join(ROOT, "control/observation-integrity/verified-read.ts"), "utf8");
  check("O3. the high-level read runs before the positioned read",
    vr.indexOf("METHOD 1: high-level read") < vr.indexOf("METHOD 2: positioned descriptor read"),
    "ordering preserved so a positioned read cannot mask the anomaly");

  // ================= S. real stores, through the boundary =================
  const stores = [
    "software/registry-database/data/canonical/resources.jsonl",
    "software/registry-database/data/canonical/capabilities.jsonl",
    "software/registry-database/data/canonical/relationships.jsonl",
    "software/registry-database/data/canonical/evidence.jsonl",
    "software/registry-database/data/canonical/registration_events.jsonl",
    "software/registry-database/data/cross-system/relationships.jsonl",
    "software/live-census/data/verification-ledger.jsonl",
    "control/self-resource/data/self-resources.jsonl",
    "control/cost-attribution/data/attributions.jsonl",
    "control/cost-attribution/data/missing-edges.jsonl",
    "control/durable-meaning/data/admissions.jsonl",
    "control/durable-meaning/data/resource-origins.jsonl",
    "control/durable-meaning/data/vocabularies.jsonl",
    "control/computer-use-executor/data/execution-evidence.jsonl",
    "control/computer-use-executor/data/diagnostic-findings.jsonl",
    "control/computer-use-executor/data/diagnostic-procedures.jsonl",
  ];
  const results = stores.map((s) => ({ s, r: verifiedReadJsonl(join(ROOT, s)) }));
  const conflicts = results.filter((x) => x.r.outcome === "READ_CONFLICT" || x.r.outcome === "TARGET_CHANGED_DURING_READ");
  for (const { s, r } of results) {
    console.log(`      ${r.outcome.padEnd(24)} ${r.integrity.consistency_state.padEnd(12)} rows=${String(r.row_count ?? "-").padStart(6)} ${s.split("/").slice(-2).join("/")}`);
  }
  check("S1. every critical store was read through two independent methods",
    results.every((x) => x.r.integrity.observations.filter((o) => o.method !== "METADATA_STAT").length === 2));
  check("S2. store conflicts are reported as conflicts, not as corruption",
    conflicts.every((x) => x.r.rows === null),
    conflicts.length === 0 ? "0 conflicts this run" : `${conflicts.length} conflicted: ${conflicts.map((c) => c.s).join(", ")}`);
  check("S3. no store was declared intact from a single read path",
    results.filter((x) => x.r.outcome === "READ_SUCCEEDED").every((x) => x.r.integrity.consistency_state === "CONSISTENT"));

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
