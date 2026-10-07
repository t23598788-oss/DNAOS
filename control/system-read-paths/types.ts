/**
 * หน้าที่: type contracts for `control/system-read-paths/` — the DECLARED
 * read-path registry (Owner, 2026-08-26).
 *
 * WHY THIS EXISTS: `control/agent-gateway/contract.ts` had exported
 * `loadEvidenceForTask` all along, and it was missed until someone read the
 * source by hand. Discovering what the system can answer by grepping is not a
 * method — it fails silently and it fails quietly. A read path is now something
 * the system DECLARES, and `./registry.ts` verifies that every declaration
 * points at a function that really exists.
 *
 * REQUEST AND RESPONSE ARE TWO SEPARATE DECLARATIONS. There is no `↔` in this
 * file. `A --REQUEST--> B` and `A <--RESPONSE-- B` are different objects with
 * different schemas, because they carry different information and fail in
 * different ways.
 *
 * Input: none (pure type definitions).
 * Output: `ReadPathDeclaration`, `ReadRequestSpec`, `ReadResponseSpec`,
 * `ReadPathVerification`, `ReadDomain`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามประกาศ read path ที่ไม่มีฟังก์ชันจริงรองรับ — ./registry.ts's verifier
 *   will fail the declaration, and that failure is the point.
 * - ห้ามรวม request กับ response เป็น edge เดียว.
 * - ห้ามให้ response ไม่มี provenance.
 */

export type ReadDomain = "RESOURCE" | "CAPABILITY" | "TASK" | "EVIDENCE" | "EVENT" | "STATE" | "DOCUMENT" | "CONTINUATION";

/** A --REQUEST--> B. What is sent, and what identifies the thing being asked about. */
export interface ReadRequestSpec {
  /** The field(s) the caller must supply. */
  sends: readonly string[];
  /** The one field the store looks up by. Never a free-text phrase — a phrase is the semantic layer's business, not a lookup key. */
  lookup_key: string;
  /** What the caller may NOT send — kept explicit so the boundary is readable at the declaration, not only in prose. */
  never_sends: readonly string[];
}

/** A <--RESPONSE-- B. What comes back, and what proves it. */
export interface ReadResponseSpec {
  returns: readonly string[];
  /** Which provenance every returned row carries. */
  provenance: "REGISTRY" | "RESOURCE_GRAPH" | "RUNTIME" | "HISTORY" | "EVIDENCE" | "DOCUMENT";
  /** The response's explicit not-found shape. A read path with no declared failure state is not declared. */
  failure_state: string;
  carries_evidence: boolean;
}

export interface ReadPathDeclaration {
  id: string;
  domain: ReadDomain;
  /** Human-readable: what question this path answers. */
  answers: string;
  request: ReadRequestSpec;
  response: ReadResponseSpec;
  /** The REAL provider. `contract_path` is the public boundary a caller imports; `symbol` is the exported function. */
  provider: { capability: string; contract_path: string; symbol: string };
  /** Where the claim that this exists can be checked. */
  evidence: readonly string[];
}

/** The result of checking a declaration against the running system — not against the source text. */
export interface ReadPathVerification {
  id: string;
  /** VERIFIED = the declared symbol resolves to a real function in this process. */
  status: "VERIFIED" | "MISSING_SYMBOL" | "NOT_ON_PUBLIC_CONTRACT" | "NO_RUNTIME_CONTRACT";
  detail: string;
}
