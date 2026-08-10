/**
 * Owner System Reality Report — Factory Gap Loop Bridge (owner,
 * 2026-08-10, Capability Roadmap #57 "OWNER SYSTEM REALITY REPORT" —
 * STEP 7, registry/TASK_QUEUE.json TASK-053/054 follow-on, Constitution
 * Rule 252 — dispatched to CODE_WORKER).
 *
 * PURPOSE: every capability app/api/admin/ide/_lib/systemRealityRuntime
 * .ts's buildSystemRealityModel() reports with status BLOCKED, DEGRADED,
 * NOT_CONNECTED, or BUILT_NOT_WIRED must be able to flow into the real
 * Factory Gap Loop (Constitution Rule 255,
 * app/api/admin/ide/_lib/gapLoopRuntime.ts) rather than staying trapped
 * inside a report nobody acts on. This file is that bridge: classify each
 * such capability's real gap via the real classifyGap(), dedupe it via
 * the real findDuplicateGap() against registry/FACTORY_CENTRAL_REGISTRY
 * .json's real, current findings, and — only for a genuinely new gap —
 * write ONE real new finding via registryWriterRuntime.ts#writeFinding(),
 * the same real acquire-lock -> re-read-fresh -> append -> release-lock
 * discipline every prior write to that file today used (Constitution
 * Rule 101/103 — reused directly, never reimplemented; see that file for
 * the real lock ledger contract, registry/LOCK_MANAGER.json).
 *
 * ============================================================
 * READ/WRITE BOUNDARY — the Owner's own explicit constraint, verbatim:
 * "Owner Report เป็น Read Model ห้ามหน้า Report ไปแก้โค้ดเอง" (the Owner
 * Report is a Read Model — the Report page must never go and modify
 * anything on its own).
 *
 * Concretely, that means:
 *  - app/api/admin/system-reality/route.ts (the real GET route the Report
 *    page calls) NEVER imports this file, directly or transitively.
 *  - app/api/admin/system-reality/_lib/ownerLanguage.ts (the real
 *    translation layer the route calls) NEVER imports this file either —
 *    it only ever reads buildSystemRealityModel()'s output.
 *  - components/workspace/SystemRealityReportSection.tsx (the real client
 *    component, including its STEP 6 polling) NEVER imports this file —
 *    polling re-fetches the read-only GET route on a timer; it does not,
 *    and structurally cannot, reach this write path.
 *  - This file contains ZERO setInterval/cron/background-loop code of its
 *    own — runGapLoopBridge() below is a plain, awaited async function
 *    that returns as soon as its one real pass over the given
 *    capabilities is done. Nothing in this repo calls it automatically.
 *
 * scripts/system-reality-gaploop-test.ts's own "Structural" test section
 * proves this boundary mechanically (a real, whole-directory grep of
 * app/api/admin/system-reality/ for any reference to "gapLoopBridge",
 * expecting exactly one hit — this file's own filename in this file's own
 * header comment/self-import guard — plus a real setInterval/cron scan of
 * this file itself), the same import-graph-scan technique
 * scripts/gap-loop-test.ts already used for gapLoopRuntime.ts's own
 * "no background loop" proof.
 *
 * The one real, intended caller of runGapLoopBridge() is a deliberate,
 * separately-triggered process — a MANAGER-07-dispatched script, or a
 * real, Owner-authorized scheduled job added later (out of this task's
 * own scope; not built here) — never a side effect of an Owner opening
 * the Report page.
 * ============================================================
 *
 * REUSE, NOT DUPLICATION (Constitution Rule 101/103):
 *  - classifyGap()/findDuplicateGap() are imported DIRECTLY from
 *    gapLoopRuntime.ts — this file never reimplements keyword-overlap
 *    dedup or category scoring.
 *  - writeFinding()/acquireLock()/releaseLock() are imported DIRECTLY
 *    from registryWriterRuntime.ts (the one, existing, sanctioned writer
 *    for registry/FACTORY_CENTRAL_REGISTRY.json, built 2026-08-09 for
 *    GAP-1) — this file never opens its own writeFileSync against that
 *    registry.
 *  - buildSystemRealityModel() is imported DIRECTLY from
 *    systemRealityRuntime.ts — this file never re-derives capability
 *    status from the underlying registries itself.
 *
 * DISCLOSED, HONEST LIMITATION (Constitution Rule 100/106): the dedup
 * check below is the SAME real, deterministic keyword-overlap-coefficient
 * mechanism every other consumer of findDuplicateGap()/extractKeywords()
 * in this repo already uses (managerQuestionRuntime.ts's own header names
 * this limitation first) — NOT full natural-language understanding. A
 * capability whose prose happens to name an existing finding_id (e.g. the
 * AI capability's own current_blocker literally contains the text
 * "FCR-015") is not guaranteed to keyword-overlap-match that finding
 * above the real 0.5 threshold if the surrounding wording differs enough
 * — a real, bounded, already-disclosed class of false negative, not a
 * defect introduced here. See scripts/system-reality-gaploop-test.ts's
 * own captured evidence for which of today's real, live 4-state
 * capabilities do and do not clear that threshold against the real,
 * live registry as of this build.
 */
import { readFileSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "@/app/api/admin/ide/_lib/fsSecurity";
import {
  buildSystemRealityModel,
  type CapabilityRealityEntry,
  type CapabilityStatus,
  type SystemRealityModelOptions,
} from "@/app/api/admin/ide/_lib/systemRealityRuntime";
import { classifyGap, findDuplicateGap, type GapClassification, type ExistingFindingForDedup } from "@/app/api/admin/ide/_lib/gapLoopRuntime";
import { writeFinding, type FindingSource, type WriteFindingInput } from "@/app/api/admin/ide/_lib/registryWriterRuntime";

const ROOT = WORKSPACE_ROOT;
const FCR_REL_PATH = "registry/FACTORY_CENTRAL_REGISTRY.json";

/** The 4 real capability statuses this bridge triggers on — named
 * verbatim by this task's own instruction ("Every capability ... with
 * status BLOCKED, DEGRADED, NOT_CONNECTED, or BUILT_NOT_WIRED"). */
export const TRIGGER_STATUSES: readonly CapabilityStatus[] = [
  "BLOCKED", "DEGRADED", "NOT_CONNECTED", "BUILT_NOT_WIRED",
];

export type GapBridgeAction = "CREATED" | "SKIPPED_DUPLICATE" | "SKIPPED_ERROR";

export interface GapBridgeResult {
  capability_name: string;
  status: CapabilityStatus;
  action: GapBridgeAction;
  /** The real, newly-created finding_id (action=CREATED), the real,
   * already-existing matched finding_id (action=SKIPPED_DUPLICATE), or
   * null (action=SKIPPED_ERROR). */
  finding_id: string | null;
  classification: GapClassification;
  duplicate?: { matchedFindingId: string; overlapScore: number };
  error?: string;
}

interface FcrFindingsFile {
  findings: Array<{ finding_id: string; description?: string; evaluation?: string; status: string }>;
}

/** Real, fresh read of registry/FACTORY_CENTRAL_REGISTRY.json's current
 * findings — re-read on EVERY capability in the loop below (not cached
 * once for the whole run), so a finding this same run just created is
 * correctly visible as a real dedup target for the very next capability
 * in the same pass (two different capabilities can honestly describe the
 * same underlying real gap; the second must not create a second,
 * duplicate finding just because it was processed a moment later). */
function loadExistingFindingsForDedup(): ExistingFindingForDedup[] {
  const raw = JSON.parse(readFileSync(path.join(ROOT, FCR_REL_PATH), "utf-8")) as FcrFindingsFile;
  return raw.findings.map((f) => ({ finding_id: f.finding_id, description: f.description, evaluation: f.evaluation }));
}

/** Real, deterministic text this bridge classifies/dedupes against —
 * `capability_name` + `current_blocker` + `missing_connection`, the 3
 * real fields on CapabilityRealityEntry that actually describe WHAT is
 * wrong (never a new, fabricated summary sentence). `business_function`/
 * `runtime_status`/`impact` are deliberately excluded here: real testing
 * against this build's own live model (captured in this file's
 * acceptance suite) showed including them dilutes the real keyword-
 * overlap signal below findDuplicateGap()'s 0.5 threshold even for
 * capabilities that DO already have a matching FCR entry (their generic,
 * boilerplate-heavy prose adds many keywords that don't appear in the
 * matching finding's own text) — current_blocker/missing_connection are
 * the fields that actually carry the specific, comparable gap
 * description. */
function capabilityGapText(c: CapabilityRealityEntry): string {
  return [c.capability_name, c.current_blocker ?? "", c.missing_connection ?? ""].join(" \n ");
}

/** Real evidence excerpts carried from the capability's own real
 * evidence[] into the written finding — never fabricated, always a
 * verbatim (possibly truncated for very long entries) copy of what
 * systemRealityRuntime.ts already cited. */
function toFindingEvidence(c: CapabilityRealityEntry) {
  const now = new Date().toISOString();
  return c.evidence.map((excerpt) => ({
    source_url: null,
    source_type: "internal_registry" as const,
    excerpt,
    captured_at: now,
  }));
}

export interface RunGapLoopBridgeOptions extends SystemRealityModelOptions {
  /** When true, computes and returns exactly what WOULD happen (classify
   * + dedup, real reads only) WITHOUT calling writeFinding() — a real,
   * safe dry-run. Defaults to false (a real caller that wants a real
   * write must say so explicitly — no accidental writes from a default
   * call). */
  dryRun?: boolean;
  /** Real, injectable capability list. When omitted, this function calls
   * the real, live buildSystemRealityModel() itself. Exists so a caller
   * (this file's own acceptance test, or a future targeted MANAGER-07
   * re-run) can run the bridge against ONE specific, already-known
   * capability instead of the full, live, 17-capability model — e.g. a
   * deliberately-disposable synthetic test fixture that must never
   * pollute the real registry with an unrelated write. */
  capabilities?: CapabilityRealityEntry[];
  source?: FindingSource;
  sourceEntity?: string;
}

/**
 * Real, explicit, separately-triggered entry point (see this file's
 * header for the read/write boundary this deliberately respects — it is
 * NEVER called from the Report page's own GET route).
 *
 * For every real capability in `options.capabilities` (or, by default,
 * the real, live buildSystemRealityModel() output) whose status is one
 * of TRIGGER_STATUSES: real-classify it via classifyGap(), real-check it
 * against registry/FACTORY_CENTRAL_REGISTRY.json's real, current findings
 * via findDuplicateGap() (re-read fresh per iteration, see
 * loadExistingFindingsForDedup()'s own doc comment), and — only when
 * genuinely new and `options.dryRun` is not set — write ONE real new
 * finding via registryWriterRuntime.ts#writeFinding().
 */
export async function runGapLoopBridge(options: RunGapLoopBridgeOptions = {}): Promise<GapBridgeResult[]> {
  const capabilities = options.capabilities ?? (await buildSystemRealityModel(options)).capabilities;
  const triggered = capabilities.filter((c) => TRIGGER_STATUSES.includes(c.status));

  const results: GapBridgeResult[] = [];
  for (const c of triggered) {
    const text = capabilityGapText(c);
    const classification = classifyGap(text, c.evidence);
    const existing = loadExistingFindingsForDedup();
    const dup = findDuplicateGap(text, existing);

    if (dup.isDuplicate) {
      results.push({
        capability_name: c.capability_name,
        status: c.status,
        action: "SKIPPED_DUPLICATE",
        finding_id: dup.matchedFindingId ?? null,
        classification,
        duplicate: { matchedFindingId: dup.matchedFindingId!, overlapScore: dup.overlapScore! },
      });
      continue;
    }

    if (options.dryRun) {
      results.push({ capability_name: c.capability_name, status: c.status, action: "CREATED", finding_id: null, classification });
      continue;
    }

    try {
      const input: WriteFindingInput = {
        type: classification.type === "UNCLASSIFIED" ? "UNCLASSIFIED" : classification.type,
        description: `[System Reality Report Gap Loop Bridge] ${c.capability_name} (${c.status}): ${c.current_blocker ?? c.missing_connection ?? c.impact}`,
        SOURCE: options.source ?? "MANAGER",
        source_entity: options.sourceEntity ?? "MANAGER-07 (via Owner System Reality Report Gap Loop Bridge)",
        status: "NEW",
        evidence: toFindingEvidence(c),
      };
      const finding_id = writeFinding(input);
      results.push({ capability_name: c.capability_name, status: c.status, action: "CREATED", finding_id, classification });
    } catch (e) {
      results.push({
        capability_name: c.capability_name,
        status: c.status,
        action: "SKIPPED_ERROR",
        finding_id: null,
        classification,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}
