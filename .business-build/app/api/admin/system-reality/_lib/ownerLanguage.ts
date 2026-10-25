/**
 * Owner Language Translation Layer (owner, 2026-08-10, Capability
 * Roadmap #57 "OWNER SYSTEM REALITY REPORT" — STEP 4+5, registry/
 * TASK_QUEUE.json TASK-053 follow-on, Constitution Rule 252 — dispatched
 * to CODE_WORKER).
 *
 * PURPOSE: take the real, evidence-based output of
 * app/api/admin/ide/_lib/systemRealityRuntime.ts's buildSystemRealityModel()
 * (STEP 2+3, already built, tested 26/26, read-only from here — never
 * re-derived or duplicated) and produce the Owner-facing shape STEP 4's 5
 * required sections need, honoring STEP 5's hard rule: the Owner-facing
 * layer must never show TypeScript/Git/Commit/registry filenames/stack
 * traces/module paths — that real technical detail must still be
 * genuinely present, just moved into a `drilldown` field on every card
 * this file returns, never deleted.
 *
 * CONNECT-BEFORE-CREATE (Rule 101/103): this file does not re-read any
 * registry/JSON source directly and does not reimplement any status
 * computation — every real fact originates from buildSystemRealityModel()
 * /the ConnectionGapEntry array already on its `connections` field. This
 * file's only real job is (a) aggregate a whole-system status from the
 * real per-capability statuses already computed, and (b) translate
 * already-real fields into plain sentences + split raw technical
 * fragments into a separate `drilldown` object.
 *
 * REAL STRUCTURAL NOTE on the runtime this file builds on: systemReality
 * Runtime.ts exports `buildSystemRealityModel()` but does NOT export its
 * internal `buildConnectionGapMap()` helper — the Connection Gap Map is
 * only reachable via `SystemRealityModel.connections`, the field that
 * function's own real output is composed into. This file reads it from
 * there, not by calling a (non-existent, from here) exported function of
 * that name — a real correction vs. this task's own briefing text, not a
 * defect in systemRealityRuntime.ts (its own connections field IS the
 * real gap map, just reached one level differently than described).
 *
 * HONESTY RULE (Constitution Rule 100): the sanitizer below is a real,
 * mechanical text transform (strip parentheticals/tokens that carry a
 * banned technical marker), not a rewrite of meaning — it never adds a
 * claim, confidence level, or fact that was not already in the real
 * source string. Where sanitizing would leave nothing meaningful behind,
 * the original field is still fully present in `drilldown`.
 */
import {
  buildSystemRealityModel,
  type CapabilityRealityEntry,
  type CapabilityStatus,
  type ConnectionGapEntry,
  type ConnectionLinkState,
  type SystemRealityModelOptions,
} from "@/app/api/admin/ide/_lib/systemRealityRuntime";

// ============================================================
// Owner-facing enums / plain-language labels for the real, technical
// enums the runtime computes. These are STATIC label text only — never a
// substitute for the real computed status itself (status is still
// carried alongside the label on every card, for the UI's tone/icon).
// ============================================================
export type OwnerSystemStatus = "READY" | "DEGRADED" | "BLOCKED";

export const STATUS_LABELS: Record<CapabilityStatus, string> = {
  LIVE: "Working now",
  DEGRADED: "Working, but only partly",
  BLOCKED: "Stuck — not working",
  NOT_CONNECTED: "Built, but not linked up yet",
  BUILT_NOT_WIRED: "Built, but not turned on yet",
  WIRED_NOT_TESTED: "Turned on, but not proven with a real test yet",
  NOT_BUILT: "Not built yet",
  UNKNOWN: "Status unknown — no real evidence available",
};

export const CONNECTION_STATE_LABELS: Record<ConnectionLinkState, string> = {
  CONNECTED: "Connected",
  NOT_CONNECTED: "Not connected",
  CONNECTED_NOT_TESTED: "Connected, but not proven yet",
  WAS_WORKING_NOW_BROKEN: "Used to work — now broken",
};

// ============================================================
// Sanitizer — the one real, mechanical function every Owner-facing text
// field in this file passes through before being placed at the top
// level of a card. See this file's header for the honesty rule this
// follows (never adds meaning, only removes technical markers).
// ============================================================
// Extension alternation MUST list longer/more-specific extensions before a
// shorter one that is also a valid prefix of it (tsx before ts, jsx before
// js, json before js) — regex alternation picks the first alternative that
// matches, not the longest, so "json" would otherwise never be reached
// (the engine would already have matched and stopped at "js", leaving "on"
// as dangling literal text; caught live by this file's own acceptance
// test while sanitizing a real registry/WORKER_IDENTITIES.json mention).
const FILE_PATH_SRC = String.raw`[\w.\-/[\]]*[\w-]\.(?:tsx|ts|jsx|json|js|sql|md)(?::\d+(?:-\d+)?)?(?:#[\w]+)?(?:'s)?`;
const FINDING_ID_SRC = String.raw`(?:FCR|DNA)-\d+`;
const BANNED_WORD_SRC = String.raw`TypeScript|Git|Commit|compile[- ]errors?|stack traces?|\bFCR\b`;
const COUNTED_BANNED_PHRASE_SRC = String.raw`(?:the\s+)?(?:\d+|one|two|three|a|an)\s+real\s+(?:compile[- ]errors?|stack traces?)`;

function containsBannedMarker(text: string): boolean {
  return (
    new RegExp(FILE_PATH_SRC, "i").test(text) ||
    new RegExp(FINDING_ID_SRC, "i").test(text) ||
    new RegExp(`\\b(?:${BANNED_WORD_SRC})\\b`, "i").test(text)
  );
}

/** Real, mechanical Owner-language sanitizer. Never invents text — only
 * removes technical markers (module/file paths, registry filenames,
 * TypeScript/Git/Commit/compile-error/stack-trace/finding-id tokens) and
 * cleans up the punctuation/whitespace left behind by their removal. The
 * original, unsanitized string is always separately preserved in the
 * caller's `drilldown` object — this function never deletes information,
 * only decides what appears at the top Owner-facing layer. */
export function sanitizeOwnerText(raw: string): string {
  let text = raw;

  // 1. Drop whole parenthetical asides that themselves carry a banned
  //    marker — safer than surgically deleting just the token, which
  //    tends to leave broken/misleading grammar behind (single pass over
  //    non-nested parens, which is every real case in this runtime's
  //    output today).
  text = text.replace(/\(([^()]*)\)/g, (whole, inner: string) => (containsBannedMarker(inner) ? "" : whole));

  // 2. Drop "(the) N real compile error(s)/stack trace(s)" as one phrase
  //    (count + noun together), so a bare mention outside parens doesn't
  //    leave a dangling count/article behind.
  text = text.replace(new RegExp(COUNTED_BANNED_PHRASE_SRC, "gi"), "");

  // 3. A module/file-path token that is the object of a preposition
  //    ("wire X into engines/foo.ts", "export to gateway/actions.ts") reads
  //    as broken grammar if just deleted ("into before...", "to  (or...)").
  //    Replace token-with-preposition as a pair with a real, honest, still
  //    generic placeholder ("into the system") — this changes wording, not
  //    meaning: the real fact being stated ("something needs wiring in") is
  //    unchanged, only the specific internal name is generalized away, per
  //    this file's own honesty rule (never adds a NEW claim).
  text = text.replace(new RegExp(String.raw`\b(to|into|from)\s+(${FILE_PATH_SRC})`, "gi"), (_m, prep: string, tok: string) => `${prep} the system${tok.endsWith("'s") ? "'s" : ""}`);

  // 4. Drop any remaining bare banned tokens still in flowing text.
  text = text.replace(new RegExp(FILE_PATH_SRC, "gi"), "");
  text = text.replace(new RegExp(FINDING_ID_SRC, "gi"), "");
  text = text.replace(new RegExp(`\\b(?:${BANNED_WORD_SRC})\\b`, "gi"), "");

  // 5. Whitespace/punctuation cleanup left behind by removals above.
  text = text
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*(and|or)\b/gi, " $1")
    .replace(/\s*[-–—]\s*[-–—]+\s*/g, " — ")
    .replace(/^[\s,.;:—-]+/, "")
    .replace(/[\s,;:—-]+$/, (m) => (m.trim().endsWith(".") ? "." : ""))
    .trim();

  return text;
}

/** Real, structural proof-helper for the acceptance test: true if `text`
 * still contains any of the hard-banned technical terms (used to assert
 * the Owner-facing layer is clean, and, inverted, that the SAME real
 * detail still exists in the raw/drilldown copy). */
export function containsHardBannedTerm(text: string): boolean {
  return containsBannedMarker(text);
}

// ARCHITECTURE RUNTIME INTEGRATION (owner, 2026-10-18, STEP 08, additive): ส่งต่อ
// บล็อก audit ใหม่จาก systemRealityRuntime.ts — TECHNICAL LAYER เท่านั้น (เป็น
// ทะเบียนจริง/ตัวเลข/เหตุผล ไม่ใช่ความหมายธุรกิจใหม่ที่ต้อง sanitize) ไม่แตะเส้นทาง
// Owner-language เดิมเลย ไม่แตะ contract เดิม — field เป็น optional passthrough
// แทนการเขียน reader/API คู่ขนาน
import type {
  RuleComplianceBlock,
  TestResultsBlock,
  CapabilityReadinessEntry,
  OpenDefectEntry,
} from "@/app/api/admin/ide/_lib/systemRealityRuntime";

// ============================================================
// Owner-facing card shapes. Every `drilldown` field below is the real,
// unsanitized technical detail — present and reachable, never deleted,
// just not rendered by default (STEP 5's own instruction).
// ============================================================
export interface OwnerCapabilityDrilldown {
  runtime_status: string;
  current_blocker: string | null;
  missing_connection: string | null;
  connected_from: string[];
  connected_to: string[];
  evidence: string[];
  last_verified: string;
  next_required_connection: string | null;
}

export interface OwnerCapabilityCard {
  capability_name: string;
  status: CapabilityStatus;
  owner_status_label: string;
  owner_summary: string;
  owner_detail: string;
  drilldown: OwnerCapabilityDrilldown;
}

export interface OwnerConnectionDrilldown {
  from_module: string | null;
  from_runtime: string | null;
  to_module: string | null;
  to_runtime: string | null;
  technical_detail: string;
  evidence: string[];
}

export interface OwnerConnectionCard {
  from: string;
  to: string;
  state: ConnectionLinkState;
  owner_state_label: string;
  business_meaning: string;
  drilldown: OwnerConnectionDrilldown;
}

export interface OwnerNextAction {
  capability_name: string;
  owner_action: string;
  drilldown: { raw_next_required_connection: string };
}

export interface SystemStatusSummary {
  value: OwnerSystemStatus;
  owner_explanation: string;
  counts: Record<CapabilityStatus, number>;
}

export interface OwnerArchAuditBlock {
  rule_compliance?: RuleComplianceBlock;
  test_results?: TestResultsBlock;
  capability_readiness?: CapabilityReadinessEntry[];
  open_defects?: OpenDefectEntry[];
}

export interface OwnerSystemRealityReport {
  generated_at: string;
  system_status: SystemStatusSummary;
  working_now: OwnerCapabilityCard[];
  not_working: OwnerCapabilityCard[];
  connection_gaps: OwnerConnectionCard[];
  next_actions: OwnerNextAction[];
  technical: {
    /** Real list of every source file/runtime this whole report ultimately
     * composed from — kept here, not in any of the 5 Owner-facing arrays
     * above, so a future technical panel can show it without it ever
     * being part of the default Owner view. */
    sources_composed: string[];
    capability_count: number;
    connection_count: number;
  };
  /** STEP 07 — 4 บล็อก audit ใหม่ (LIVE ตาม model) ส่งต่อเพื่อ render หมวด
   * 02/04/05/07 บนหน้า architecural เดิมเท่านั้น — ต้องอยู่หลัง drilldown/
   * Technical-detail toggle เสมอ หาขลาดเปิดเผย credential และห้ามแตะ denylist
   * technical fields ตั้งแต่ 5 ส่วน Owner-language ด้านบน */
  audit?: OwnerArchAuditBlock;
}

// ============================================================
// SYSTEM STATUS aggregation rule — documented here, once, per STEP 4's
// own instruction to state a real, honest rule plainly:
//
//   1. Any capability with status BLOCKED  -> overall BLOCKED. Something
//      real is completely stuck; the Owner must see that regardless of
//      how much else works.
//   2. Else, any capability with a status OTHER than LIVE (DEGRADED,
//      NOT_CONNECTED, BUILT_NOT_WIRED, WIRED_NOT_TESTED, NOT_BUILT, or
//      UNKNOWN) -> overall DEGRADED. Nothing is fully stuck, but the
//      system is not fully working either — an honest middle state,
//      not smoothed over as READY.
//   3. Else (every real capability is LIVE) -> READY.
//
// Deliberately conservative: one BLOCKED capability among many is
// enough to mark the whole system BLOCKED — the Owner should never see
// "READY" while something real is completely broken.
// ============================================================
export function computeSystemStatus(capabilities: CapabilityRealityEntry[]): SystemStatusSummary {
  const counts = Object.fromEntries(
    (["LIVE", "DEGRADED", "BLOCKED", "NOT_CONNECTED", "BUILT_NOT_WIRED", "WIRED_NOT_TESTED", "NOT_BUILT", "UNKNOWN"] as CapabilityStatus[]).map(
      (s) => [s, capabilities.filter((c) => c.status === s).length] as const,
    ),
  ) as Record<CapabilityStatus, number>;

  let value: OwnerSystemStatus;
  let owner_explanation: string;
  if (counts.BLOCKED > 0) {
    value = "BLOCKED";
    owner_explanation = `${counts.BLOCKED} of ${capabilities.length} real capabilities are completely stuck right now — see "Not Working / Not Connected" below for which ones and why.`;
  } else if (capabilities.some((c) => c.status !== "LIVE")) {
    const workingCount = counts.LIVE;
    value = "DEGRADED";
    owner_explanation = `${workingCount} of ${capabilities.length} real capabilities are fully working — the rest are partly working, not yet connected, or not yet proven. See both lists below for detail.`;
  } else {
    value = "READY";
    owner_explanation = `All ${capabilities.length} real capabilities this report checks are working now.`;
  }
  return { value, owner_explanation, counts };
}

// ============================================================
// WORKING NOW judgment call (STEP 4 asked for real judgment, documented,
// not a blanket rule): only status LIVE counts as "working now" here.
// This build's real, current data has zero capabilities at
// WIRED_NOT_TESTED — but the rule is stated for when one appears in the
// future: a WIRED_NOT_TESTED capability is really wired in, but has not
// been proven against real production evidence yet. Showing it under
// "Working Now" would overstate confidence the runtime itself does not
// have. It is therefore listed under "Not Working / Not Connected" with
// its own honest label ("Turned on, but not proven with a real test
// yet"), distinct from BLOCKED.
// ============================================================
const WORKING_NOW_STATUSES: ReadonlySet<CapabilityStatus> = new Set(["LIVE"]);

function toCapabilityCard(entry: CapabilityRealityEntry): OwnerCapabilityCard {
  return {
    capability_name: entry.capability_name,
    status: entry.status,
    owner_status_label: STATUS_LABELS[entry.status],
    owner_summary: sanitizeOwnerText(entry.business_function),
    owner_detail: sanitizeOwnerText(entry.impact),
    drilldown: {
      runtime_status: entry.runtime_status,
      current_blocker: entry.current_blocker,
      missing_connection: entry.missing_connection,
      connected_from: entry.connected_from,
      connected_to: entry.connected_to,
      evidence: entry.evidence,
      last_verified: entry.last_verified,
      next_required_connection: entry.next_required_connection,
    },
  };
}

function toConnectionCard(entry: ConnectionGapEntry): OwnerConnectionCard {
  return {
    from: entry.from,
    to: entry.to,
    state: entry.state,
    owner_state_label: CONNECTION_STATE_LABELS[entry.state],
    business_meaning: sanitizeOwnerText(entry.business_meaning),
    drilldown: {
      from_module: entry.drilldown.from_module,
      from_runtime: entry.drilldown.from_runtime,
      to_module: entry.drilldown.to_module,
      to_runtime: entry.drilldown.to_runtime,
      technical_detail: entry.drilldown.technical_detail,
      evidence: entry.evidence,
    },
  };
}

/** Real, top-level composition function — the same one both the API
 * route and this build's own acceptance test call directly (per this
 * task's own acceptance requirement: "call your new API route's
 * underlying handler function"). Pure aggregation/translation over
 * buildSystemRealityModel()'s real output; no new fact computed here. */
export async function buildOwnerSystemRealityReport(options: SystemRealityModelOptions = {}): Promise<OwnerSystemRealityReport> {
  const model = await buildSystemRealityModel(options);

  const cards = model.capabilities.map(toCapabilityCard);
  const working_now = cards.filter((c) => WORKING_NOW_STATUSES.has(c.status));
  const not_working = cards.filter((c) => !WORKING_NOW_STATUSES.has(c.status));

  const connection_gaps = model.connections.map(toConnectionCard);

  const next_actions: OwnerNextAction[] = model.capabilities
    .filter((c): c is CapabilityRealityEntry & { next_required_connection: string } => !!c.next_required_connection)
    .map((c) => ({
      capability_name: c.capability_name,
      owner_action: sanitizeOwnerText(c.next_required_connection),
      drilldown: { raw_next_required_connection: c.next_required_connection },
    }));

  return {
    generated_at: model.generated_at,
    system_status: computeSystemStatus(model.capabilities),
    working_now,
    not_working,
    connection_gaps,
    next_actions,
    technical: {
      sources_composed: model.sources_composed,
      capability_count: model.capabilities.length,
      connection_count: model.connections.length,
    },
    // STEP 08 passthrough (LIVE blocks, additive — เมื่อ runtime ให้บล็อกไหนไม่ได้=
    // undefined จริงใจ ห้ามเติมค่าเทียม)
    audit: {
      ...(model.rule_compliance ? { rule_compliance: model.rule_compliance } : {}),
      ...(model.test_results ? { test_results: model.test_results } : {}),
      ...(model.capability_readiness ? { capability_readiness: model.capability_readiness } : {}),
      ...(model.open_defects ? { open_defects: model.open_defects } : {}),
    } satisfies OwnerArchAuditBlock,
  };
}
