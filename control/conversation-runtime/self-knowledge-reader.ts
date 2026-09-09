/**
 * หน้าที่: CONNECT_PROGRAM_SELF_KNOWLEDGE_TO_OWNER_CONVERSATION (Owner
 * UNLOCK 2026-09-06), question-type CLASSIFICATION removed by
 * REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING (Owner UNLOCK
 * 2026-09-07). Answers fixed question groups about the running program
 * itself — "มึงคือระบบอะไร", "source อยู่ไหน", "build มาจากอะไร", "DNA OS มี
 * ความสามารถอะไรบ้าง", plus the source-identity kinds added by
 * CONNECT_SOURCE_IDENTITY_AND_GITHUB_PROVENANCE_TO_SELF_KNOWLEDGE — from
 * registries that already exist.
 *
 * PHASE 7 (REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING):
 * this file no longer decides WHICH kind of question was asked — it used to
 * hold a `PATTERNS`/`detectSelfKnowledgeQuery` regex list enumerating Owner
 * pronouns ("มึง|เธอ|คุณ") and phrasings ("มาจากไหน", "ชื่ออะไร", ...), which
 * is exactly the hardcoding that task removed. That decision now lives in
 * `./self-question-classifier.ts` (a real semantic classification via the
 * sandboxed language processor, validated against a closed enum) and
 * `./subject-router.ts` (which resolves SELF vs. a named subject before
 * this file is ever called). This file receives only an already-resolved
 * `SelfKnowledgeQueryKind` — SELF_KNOWLEDGE_READER_READS_RAW_TEXT = NO — and
 * answers strictly from build-manifest/capability-registry facts.
 *
 * SOURCES USED, and why each ONE was picked over the alternative the task
 * also allowed:
 * - `./read-build-manifest.ts` — PROGRAM_ID, SOURCE_REPOSITORY, SOURCE_PATH,
 *   BUILD_ID/TIME/HASH, and BUILD_FROM_COMMIT/DIRTY. This doubles as the
 *   "runtime-revision" source the task also names: `runtime-revision`'s
 *   OWN contract (`../runtime-revision/contract.ts`) calls `execFileSync`
 *   for `git rev-parse` — importing it here would add a SECOND
 *   `node:child_process` user to this process, which
 *   `./tests/dependency-gate.test.ts` exists specifically to catch (see
 *   `REMOVE_TSX_FROM_PRODUCTION_CONVERSATION_RUNTIME`). The build manifest
 *   already carries the git commit it was built from, captured once at
 *   BUILD TIME by `./build-manifest-writer.ts` (which does run
 *   `runtime-revision`, but only as a build-time script, never inside this
 *   process) — reusing it here answers the same question with the same
 *   real evidence, without reopening that boundary.
 * - `readCapabilitySummaries()` (`../conversation-read-model/contract.ts`)
 *   — for "DNA OS มีความสามารถอะไรบ้าง". `control/machine-model/self-knowledge.ts`
 *   is the other source the task named, but its own import closure pulls in
 *   `control/owner-backbone/route-dispatch#EXECUTOR_BINDINGS` — execution-
 *   adjacent, and importing it here would fail the same hard gate for the
 *   same reason. The capability registry projection already gives a real,
 *   evidenced list; it just cannot yet state each capability's PURPOSE the
 *   way `machine-model` could — reported as `UNKNOWN` per field, not
 *   invented, exactly as instructed.
 *
 * Input: an already-resolved `SelfKnowledgeQueryKind` (never raw Owner
 * text).
 * Output: `answerSelfKnowledgeQuery`.
 * Dependency ที่อนุญาต: ./read-build-manifest.ts, ../conversation-read-model/contract.ts.
 * สิ่งที่ห้ามแตะ: ห้าม import `../runtime-revision/contract.ts` หรือ
 * `../../control/machine-model/contract.ts` เข้าไฟล์นี้ — เหตุผลข้างบน.
 * ห้ามเติมข้อความที่ไม่มีหลักฐานรองรับ. ห้ามเพิ่ม parameter รับ raw text —
 * PHASE 7's SELF_KNOWLEDGE_READER_READS_RAW_TEXT=NO invariant.
 */

import { readBuildManifest } from "./read-build-manifest";
import { readCapabilitySummaries } from "../conversation-read-model/contract";
import { loadConnectionSummaries, renderConnectionSummariesForOwner } from "./connection-summary";
import type { ConnectionSummaryV1 } from "./connection-summary";
import { ensureSafeCanonicalIngest } from "../canonical-information/ingest-safe";
import { listEntitiesByType, projectOwnerInformation } from "../canonical-information/query";

/**
 * PHASE 2 (REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING):
 * canonical question types — reused verbatim from before that task (no
 * human wording in any value), now produced exclusively by
 * `./self-question-classifier.ts#classifySelfQuestion`'s
 * `ALLOWED_SELF_QUESTION_TYPES` instead of a phrase-regex list.
 */
export type SelfKnowledgeQueryKind =
  | "WHAT_AM_I"
  | "SOURCE"
  | "BUILD"
  | "CAPABILITIES"
  | "CONNECTIONS"
  | "REPOSITORY"
  | "SYNC_STATE"
  | "RECOVERY_SOURCE"
  | "ROLE"
  | "DIRTY";

export interface SelfKnowledgeAnswer {
  readonly answer: string;
  readonly source_records: readonly string[];
  readonly connection_summaries?: readonly ConnectionSummaryV1[];
}

const UNKNOWN = "ไม่ทราบ (UNKNOWN — ไม่มีหลักฐานในทะเบียน)";

function answerConnections(): SelfKnowledgeAnswer {
  ensureSafeCanonicalIngest();
  const { summaries, source } = loadConnectionSummaries();
  if (summaries.length === 0) {
    return { answer: `${UNKNOWN}: ไม่พบ authoritative Connection Index หรือ connection document`, source_records: [source, "control/command-router/capability-registry.ts"] };
  }
  return {
    answer: renderConnectionSummariesForOwner(summaries, false),
    source_records: [source, ...summaries.map((row) => row.evidence_ref), "control/command-router/capability-registry.ts", "control/canonical-information"],
    connection_summaries: summaries,
  };
}

export function answerSelfKnowledgeQuery(kind: SelfKnowledgeQueryKind): SelfKnowledgeAnswer {
  if (kind === "SOURCE" || kind === "WHAT_AM_I" || kind === "BUILD" || kind === "REPOSITORY" || kind === "SYNC_STATE" || kind === "RECOVERY_SOURCE" || kind === "ROLE" || kind === "DIRTY") {
    const result = readBuildManifest();
    if (!result.found) return { answer: `${UNKNOWN}: ${result.reason}`, source_records: [result.source] };
    const m = result.manifest;

    if (kind === "BUILD") {
      const dirtyNote = m.BUILD_FROM_COMMIT_DIRTY ? "มี uncommitted changes (dirty = true)" : "ตรงกับ commit เป๊ะ (clean)";
      return {
        answer: `build ${m.BUILD_ID} (เวลา ${m.BUILD_TIME}) มาจาก source revision ${m.BUILD_FROM_COMMIT ?? UNKNOWN} — ${dirtyNote}. BUILD_HASH=${m.BUILD_HASH}`,
        source_records: [result.source],
      };
    }

    // CONNECT_SOURCE_IDENTITY_AND_GITHUB_PROVENANCE_TO_SELF_KNOWLEDGE
    // (Owner UNLOCK 2026-09-07): PHASE 5 question kinds, each answered
    // strictly from build-manifest.json fields captured at build time —
    // never re-derived, never guessed when a field is null.
    if (kind === "REPOSITORY") {
      return m.REPOSITORY_ID
        ? { answer: `อยู่ repository "${m.REPOSITORY_ID}" บน ${m.REMOTE_PROVIDER} (remote: ${m.SOURCE_REPOSITORY})`, source_records: [result.source] }
        : { answer: `${UNKNOWN}: remote URL (${m.SOURCE_REPOSITORY}) ไม่ตรงรูปแบบ github.com ที่ตรวจสอบได้`, source_records: [result.source] };
    }

    if (kind === "SYNC_STATE") {
      const staleness = m.LAST_FETCH_AT ? `ข้อมูลนี้เทียบกับ remote-tracking ref ล่าสุดที่ fetch เมื่อ ${m.LAST_FETCH_AT} (ไม่ได้เช็คเครือข่ายตอนนี้)` : "ไม่เคยมีการ fetch จาก remote ในเครื่องนี้";
      const counts = m.AHEAD_COUNT !== null && m.BEHIND_COUNT !== null ? `ahead=${m.AHEAD_COUNT}, behind=${m.BEHIND_COUNT}` : "ahead/behind ไม่ทราบ";
      return { answer: `สถานะ: ${m.SYNC_STATE} (${counts}). ${staleness}`, source_records: [result.source] };
    }

    if (kind === "RECOVERY_SOURCE") {
      if (!m.REPOSITORY_ID) return { answer: `${UNKNOWN}: ไม่พบ GitHub repository ที่พิสูจน์ได้จาก remote จริง`, source_records: [result.source] };
      const caveat = m.SYNC_STATE === "IN_SYNC" ? "local กับ remote ตรงกัน ณ ตอนตรวจสอบล่าสุด" : `local อยู่ในสถานะ ${m.SYNC_STATE} — งานที่ยังไม่ push/commit จะกู้จาก GitHub ไม่ได้`;
      return { answer: `ถ้าเครื่องนี้พัง กู้ source ได้จาก GitHub repository "${m.REPOSITORY_ID}" (${m.SOURCE_REPOSITORY}), branch ${m.BRANCH ?? UNKNOWN}. ${caveat}`, source_records: [result.source] };
    }

    if (kind === "ROLE") {
      return {
        answer: `ไฟล์ที่รันอยู่นี้เป็น BUILT_ARTIFACT (compiled จาก build ${m.BUILD_ID}) ซึ่งมาจาก LOCAL_WORKING_COPY ที่ ${m.LOCAL_WORKTREE ?? UNKNOWN} ไม่ใช่ CANONICAL_REPOSITORY โดยตรง — ต้นฉบับที่เป็น canonical คือ GitHub repository "${m.REPOSITORY_ID ?? UNKNOWN}"`,
        source_records: [result.source],
      };
    }

    if (kind === "DIRTY") {
      return { answer: m.BUILD_FROM_COMMIT_DIRTY ? "ใช่ ตอนนี้ dirty (มี uncommitted changes ที่ยังไม่ได้ commit)" : "ไม่ dirty ณ ตอนที่ build ล่าสุด (ตรงกับ commit เป๊ะ)", source_records: [result.source] };
    }

    const dirtyNote = m.BUILD_FROM_COMMIT === null
      ? UNKNOWN
      : `commit ${m.BUILD_FROM_COMMIT}${m.BUILD_FROM_COMMIT_DIRTY ? " (dirty = true, มี uncommitted changes ทับอยู่)" : " (clean)"}`;
    const answer = kind === "WHAT_AM_I"
      ? `ฉันคือโปรแกรม "${m.PROGRAM_ID}" ส่วนหนึ่งของ DNA OS (repository: ${m.SOURCE_REPOSITORY})`
      : `โปรแกรม "${m.PROGRAM_ID}" มาจาก repository: ${m.SOURCE_REPOSITORY}, source หลักอยู่ที่ ${m.SOURCE_PATH}, build ปัจจุบันมาจาก ${dirtyNote}`;
    return { answer, source_records: [result.source] };
  }

  if (kind === "CONNECTIONS") return answerConnections();

  // CAPABILITIES — REGISTERED_FACT_FIRST_V1: canonical backend before capability-summaries file.
  ensureSafeCanonicalIngest();
  const canonicalCaps = listEntitiesByType("CAPABILITY");
  if (canonicalCaps.length > 0) {
    const ids = canonicalCaps.map((row) => row.canonical_name).sort();
    const connections = answerConnections();
    const projection = projectOwnerInformation(canonicalCaps[0].entity_id, "CAPABILITY_SUMMARY", "SUMMARY");
    return {
      answer: `DNA OS มีความสามารถที่ลงทะเบียนไว้ ${ids.length} รายการ (เท่าที่มีหลักฐานในทะเบียน): ${ids.join(", ")}\n\n${connections.answer}${projection ? `\n\n${projection.summary}` : ""}`,
      source_records: ["control/canonical-information", "control/command-router/capability-registry.ts", "control/conversation-read-model/data/capability-summaries.json", ...connections.source_records],
    };
  }
  const summaries = readCapabilitySummaries();
  if (summaries.length === 0) {
    return { answer: UNKNOWN, source_records: ["control/conversation-read-model/data/capability-summaries.json"] };
  }
  const ids = summaries.map((s) => s.capability_id).sort();
  // A capability question is allowed to mention an external tool or protocol.
  // Keep the capability registry as the capability authority, while also
  // projecting the authoritative connection index so the Owner never has to
  // infer connection status from capability rows. Both projections are read
  // from their existing sources; neither is copied into the other.
  const connections = answerConnections();
  return {
    answer: `DNA OS มีความสามารถที่ลงทะเบียนไว้ ${ids.length} รายการ (เท่าที่มีหลักฐานในทะเบียน): ${ids.join(", ")}\n\n${connections.answer}`,
    source_records: ["control/command-router/capability-registry.ts", "control/conversation-read-model/data/capability-summaries.json", ...connections.source_records],
  };
}
