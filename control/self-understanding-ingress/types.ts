/**
 * หน้าที่: the type contracts for STAGE 1 — INGRESS of the DNA OS
 * Self-Understanding Pipeline (Owner-approved architecture, 2026-08-22).
 * The one bounded entry a caller uses to request that the pipeline
 * inspect something — never a filesystem-roaming request, never a
 * free-form command.
 *
 * Input: none (pure type definitions).
 * Output: `SelfUnderstandingIngressRequest`, `IngressStatus`,
 * `IngressResult`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply a
 * `status`/`reason_code` — every field here is only ever produced by
 * ./resolver.ts running the real validation.
 */

/**
 * The bounded request shape the pipeline's STOP condition requires —
 * exactly these four fields, nothing else. `target`/`scope` are always
 * repository-relative references (never an absolute filesystem path,
 * never a caller-chosen destination) — the Agent proposes what it wants
 * inspected; it never walks the filesystem itself to decide.
 */
export interface SelfUnderstandingIngressRequest {
  request_id: string;
  /** Repository-relative reference to what this request wants inspected — a file, folder, or symbol reference. Never absolute, never ".."-relative. */
  target: string;
  /** Repository-relative boundary the pipeline may operate within — must contain `target`. Never wider than the caller declares. */
  scope: string;
  /** Which real question this request wants answered downstream (e.g. "inventory", "duplicate_check") — a free string this stage does not interpret; STAGE 1 only bounds the request, it never decides what happens next. */
  requested_capability: string;
}

export type IngressStatus = "ACCEPTED" | "REJECTED";

export interface IngressResult {
  status: IngressStatus;
  request_id: string | null;
  reason_code: string | null;
  /** Present only when status === "ACCEPTED" — the real, validated request every downstream stage receives, structured and machine-readable. */
  validated_request: SelfUnderstandingIngressRequest | null;
}
