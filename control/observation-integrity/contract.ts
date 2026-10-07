/**
 * หน้าที่: stop one measurement from becoming a fact. When two independent
 * observations of the same machine state disagree, the disagreement is the
 * finding — not whichever reading looked more plausible (Owner, 2026-09-02).
 *
 * THE INCIDENT THIS GENERALISES. A high-level file read returned zero bytes,
 * without error, for files whose content was completely intact — provable
 * because a positioned descriptor read returned every byte of the same file at
 * the same moment. One method said empty, another said 9,918 bytes, and the
 * metadata agreed with the second. A system that trusts the first method alone
 * concludes "file truncated", then "data loss", then "Owner decision required",
 * and every step after that is built on a measurement that was simply wrong.
 *
 * SO THE RULE IS FAIL CLOSED, NOT FAIL SENSIBLE. `deriveIntegrity` has no
 * branch that prefers the larger reading, the more recent one, the one that
 * matches `stat`, or the one from the method that is usually right. Conflict
 * yields `accepted_fact: null` and `CONFLICTING`. Choosing a winner would be
 * exactly the behaviour that produced the false incident, dressed up as
 * arbitration.
 *
 * WHY ZERO IS THE DANGEROUS VALUE. An empty read raises no exception and looks
 * like a legitimate answer. `stat_size > 0` with a content read of `0` is
 * therefore named explicitly as a conflict rather than left to the generic
 * comparison — it is the one shape most likely to be believed.
 *
 * WHAT THIS IS NOT. It is not a filesystem repair, not a retry loop that stops
 * when it likes an answer, and not a place where a model adjudicates. Retries
 * may add observations; they can never delete the conflicting one.
 *
 * Input: independent observations of one target.
 * Output: the integrity contract and deriveIntegrity.
 * Dependency ที่อนุญาต: none — pure.
 * สิ่งที่ห้ามแตะ: ห้ามเลือกผลที่ "ดูสมเหตุสมผล", ห้ามให้โมเดลตัดสิน, ห้ามลบ
 * observation ที่ขัดแย้งออกเพื่อให้ผ่าน.
 */

/** How a state was observed. Two observations count as independent only if their methods differ. */
export type ObservationMethod =
  | "HIGH_LEVEL_READ"
  | "POSITIONED_DESCRIPTOR_READ"
  | "EXTERNAL_TOOL_READ"
  | "METADATA_STAT";

export interface Observation {
  method: ObservationMethod;
  /** Bytes the method reported. Null when the method errored. */
  result_bytes: number | null;
  error: string | null;
  /** Hash of the content the method returned, when it returned any. */
  content_hash: string | null;
  observed_at: string;
}

/** Three states. There is no fourth meaning "probably fine". */
export type ConsistencyState = "CONSISTENT" | "CONFLICTING" | "INSUFFICIENT";

/** Finite reasons. A conflict must say what disagreed with what. */
export type IntegrityReason =
  | "ALL_METHODS_AGREE"
  | "FEWER_THAN_TWO_INDEPENDENT_METHODS"
  | "ALL_METHODS_ERRORED"
  | "BYTE_COUNT_DISAGREEMENT"
  | "CONTENT_HASH_DISAGREEMENT"
  /** The incident's exact shape, named so it can never be silently believed. */
  | "METADATA_NONZERO_BUT_CONTENT_READ_ZERO"
  | "TARGET_CHANGED_DURING_OBSERVATION";

export interface ObservationIntegrity {
  target_identity: string;
  observations: readonly Observation[];
  consistency_state: ConsistencyState;
  /** The agreed byte count. Null whenever the state is not CONSISTENT — never a chosen winner. */
  accepted_fact: number | null;
  reason: IntegrityReason;
  evidence_refs: readonly string[];
}

/**
 * Derives integrity from observations alone. Pure and total.
 *
 * Ordering matters and is deliberate: the metadata-vs-zero shape is checked
 * before the generic comparison, so the incident's signature is reported by its
 * own name rather than as an anonymous byte-count disagreement.
 */
export function deriveIntegrity(
  targetIdentity: string,
  observations: readonly Observation[],
  evidenceRefs: readonly string[] = [],
  targetChangedDuringObservation = false,
): ObservationIntegrity {
  const base = { target_identity: targetIdentity, observations: Object.freeze([...observations]), evidence_refs: Object.freeze([...evidenceRefs]) };
  const unresolved = (reason: IntegrityReason, state: ConsistencyState = "CONFLICTING"): ObservationIntegrity =>
    ({ ...base, consistency_state: state, accepted_fact: null, reason });

  if (targetChangedDuringObservation) return unresolved("TARGET_CHANGED_DURING_OBSERVATION");

  const content = observations.filter((o) => o.method !== "METADATA_STAT");
  const usable = content.filter((o) => o.error === null && o.result_bytes !== null);
  const stat = observations.find((o) => o.method === "METADATA_STAT");

  // The incident shape, checked first and by name.
  if (stat?.result_bytes != null && stat.result_bytes > 0 && usable.some((o) => o.result_bytes === 0)) {
    return unresolved("METADATA_NONZERO_BUT_CONTENT_READ_ZERO");
  }
  // Every method failing is not a CONTRADICTION — the methods agree that nothing
  // could be read (a missing file, a permission error). That is insufficient
  // evidence, not conflicting evidence, and the two must not be merged: a
  // conflict means something is wrong with the measurement, an insufficiency
  // means there was nothing to measure.
  if (usable.length === 0) return unresolved("ALL_METHODS_ERRORED", "INSUFFICIENT");

  // Independence is by METHOD, not by call count: reading twice the same way is
  // one observation repeated, and cannot corroborate itself.
  const distinctMethods = new Set(usable.map((o) => o.method));
  if (distinctMethods.size < 2) return unresolved("FEWER_THAN_TWO_INDEPENDENT_METHODS", "INSUFFICIENT");

  const bytes = new Set(usable.map((o) => o.result_bytes));
  if (bytes.size > 1) return unresolved("BYTE_COUNT_DISAGREEMENT");
  const hashes = new Set(usable.map((o) => o.content_hash).filter((h): h is string => h !== null));
  if (hashes.size > 1) return unresolved("CONTENT_HASH_DISAGREEMENT");
  // Metadata is corroboration, not a content method — but if it disagrees with
  // an agreed content size, that is still a conflict.
  if (stat?.result_bytes != null && stat.result_bytes !== [...bytes][0]) return unresolved("BYTE_COUNT_DISAGREEMENT");

  return { ...base, consistency_state: "CONSISTENT", accepted_fact: [...bytes][0]!, reason: "ALL_METHODS_AGREE" };
}

/** What a read attempt concluded — distinct from what it returned. */
export type FileReadOutcome = "READ_SUCCEEDED" | "READ_FAILED" | "READ_CONFLICT" | "TARGET_CHANGED_DURING_READ";

export interface VerifiedRead {
  path: string;
  outcome: FileReadOutcome;
  integrity: ObservationIntegrity;
  /** Content is returned ONLY on READ_SUCCEEDED. A conflict yields no content to act on. */
  content: string | null;
}

/**
 * Maps integrity onto a read outcome. Zero bytes is never accepted merely
 * because nothing threw, and a non-zero result is never accepted merely for
 * being non-zero — both must be corroborated by a second independent method.
 */
export function readOutcomeFrom(integrity: ObservationIntegrity, content: string | null): FileReadOutcome {
  if (integrity.reason === "TARGET_CHANGED_DURING_OBSERVATION") return "TARGET_CHANGED_DURING_READ";
  if (integrity.consistency_state === "CONFLICTING") return "READ_CONFLICT";
  if (integrity.consistency_state === "INSUFFICIENT") return "READ_FAILED";
  return content === null ? "READ_FAILED" : "READ_SUCCEEDED";
}

/**
 * What a conflict is allowed to imply. Every entry is false: a measurement
 * disagreement proves none of these, and the escalation that followed the
 * incident was built on assuming otherwise.
 */
export const CONFLICT_IMPLIES = Object.freeze({
  FILE_EMPTY: false,
  FILE_TRUNCATED: false,
  SOURCE_MISSING: false,
  CAPABILITY_BROKEN: false,
  DATA_LOSS: false,
  OWNER_DECISION_REQUIRED: false,
});
