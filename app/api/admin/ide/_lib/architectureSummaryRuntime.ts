/**
 * Architecture Summary Runtime — 4-Layer File/Folder Summary (owner,
 * 2026-08-10, Capability Roadmap #58 "ARCHITECTURE GAP EXPLORER" Wave 1b,
 * registry/TASK_QUEUE.json TASK-059, Constitution Rule 252 — dispatched to
 * CODE_WORKER).
 *
 * PURPOSE (verbatim intent from TASK-059 / capability-roadmap.json #58
 * Wave 1b): a real, ON-DEMAND translation of one real file or folder into
 * 4 real layers — Computer Language, AI Language, Business Language, Owner
 * Language (Thai) — built ONLY from real, already-structured sources this
 * repo already has. Never a live-LLM summary of source code (the Owner's
 * own explicit instruction this task originates from: "ห้ามสรุปแบบข้อความ
 * ลอย" — no floating/unfounded summaries), never fabricated when a real
 * source is silent — an honest "not yet documented" / "no known reference"
 * is always correct when real data doesn't exist.
 *
 * SCOPE DISCIPLINE (this task's own explicit instruction, same discipline
 * computeLiveReachability()/runDeadEndSweep() already established): this
 * file exposes exactly 2 real, callable, ON-DEMAND functions —
 * getFileSummary(filePath) and getFolderSummary(dirPath) — computed for
 * ONE real target at a time. It NEVER eagerly pre-computes a summary for
 * all ~1000+ files in this repo; there is no batch/background loop
 * anywhere in this file (verified structurally by this build's own
 * acceptance test, the same technique dead-end-sweep-test.ts's own
 * Structural 5f already uses).
 *
 * REUSE DECISION (Constitution Rule 101/103, done BEFORE writing this
 * file, real grep/read investigation, not assumed):
 *  - loadArchitectureBook() / type ArchNode / type ArchitectureBook are
 *    imported DIRECTLY from systemRealityRuntime.ts (the same real, cached
 *    loader deadEndSweepRuntime.ts already reuses) — this file adds ZERO
 *    new JSON.parse of registry/architecture-book.json.
 *  - buildSystemRealityModel() / type SystemRealityModel / type
 *    CapabilityRealityEntry are imported DIRECTLY from
 *    systemRealityRuntime.ts — the Business Language layer's cross-
 *    reference check reads that model's own, already-computed
 *    capabilities[].evidence[] arrays; it never re-derives capability
 *    status or business_function text itself.
 *  - sanitizeOwnerText() is imported DIRECTLY from ownerLanguage.ts (the
 *    real, mechanical Owner-language sanitizer already proven for
 *    Capability #57) — the Owner Language layer below is the exact same
 *    "compose real fragments, then sanitize once" pattern that file's own
 *    toCapabilityCard()/toConnectionCard() already use, never a
 *    reimplementation of the sanitizer.
 *  - loadModuleRegistry() / type ModuleRegistry are imported DIRECTLY from
 *    classification.ts — a real, already-exported, already-cached
 *    registry/module-registry.json reader (grep-verified before writing
 *    this file: classification.ts:72 `export function loadModuleRegistry()`
 *    is a real, existing wrapper — reading that file a second, independent
 *    way here would itself violate Rule 103). This is a DIFFERENT
 *    situation from registry/FACTORY_CENTRAL_REGISTRY.json and
 *    registry/capability-roadmap.json below, which genuinely have no
 *    existing exported wrapper anywhere in this repo (grep-verified: the
 *    only FCR reader is gapLoopRuntime.ts's own private, non-exported
 *    inline JSON.parse; capability-roadmap.json has no runtime reader at
 *    all outside doc-generation scripts) — those two are read directly
 *    here, the same "no existing wrapper, direct read is the correct
 *    non-duplicative choice" convention systemRealityRuntime.ts's own
 *    header and deadEndSweepRuntime.ts's own header already document and
 *    use for registries in exactly this situation.
 *  - Guard 13's own real stub-detection condition (scripts/pre-commit-
 *    check.sh:327, `m.status === 'unregistered' || String(m.purpose_th ||
 *    '').startsWith('[ตรวจพบอัตโนมัติ]')`) is reused VERBATIM (as a
 *    mirrored TypeScript condition, since Guard 13 lives in a bash/node -e
 *    script with no exported function this file could import) for
 *    getFolderSummary()'s missing/undocumented count — never re-derived
 *    from a different regex.
 *
 * THE 4 LAYERS, and exactly which real source each one is honestly
 * allowed to draw from — never blurred:
 *   1. Computer Language — real facts only: exports/dependents/
 *      dependencies/status from registry/architecture-book.json, real
 *      layer/owner from registry/module-registry.json. No prose, no
 *      judgment calls.
 *   2. AI Language — derived ONLY from registry/module-registry.json's
 *      real `purpose` field for this exact file (English). If that field
 *      is still the literal auto-stub ("[Auto-detected] <path>") or the
 *      file has no registry entry at all, this layer HONESTLY reports
 *      "not yet documented" / "not registered" — it NEVER calls an LLM,
 *      never summarizes the file's actual source text. When a real,
 *      human-written purpose exists, this layer is a light, mechanical
 *      reformat of it (whitespace/trim only) — not a rewrite.
 *   3. Business Language — derived ONLY from an actual, literal cross-
 *      reference: does this file's own relative path appear inside (a)
 *      one of systemRealityRuntime.ts's 17 real CapabilityRealityEntry
 *      evidence[] arrays (Capability #57's own real, live-computed
 *      model), (b) a real registry/FACTORY_CENTRAL_REGISTRY.json
 *      finding's description/evaluation text, or (c) a real registry/
 *      capability-roadmap.json capability's done/missing/note text. When
 *      found, the MATCHING capability/finding's own already-written
 *      business-language text is cited verbatim (reused, never rewritten
 *      or paraphrased). When no real match exists anywhere, this layer
 *      HONESTLY reports "no known business capability references this
 *      file yet" — it never invents a plausible-sounding business purpose.
 *      DISCLOSED LIMITATION: the cross-reference check is a real, literal
 *      substring match on the file's own relative path against already-
 *      written text — the same class of technique deadEndSweepRuntime.ts's
 *      own Pattern 3 uses for registry-reader detection. It will not
 *      catch a reference phrased without the literal path string (e.g. a
 *      prose description that names a capability but never quotes the
 *      file path), and — in principle, not observed in this repo's real
 *      current data — a very short/generic relative path could substring-
 *      match inside an unrelated longer path. Both are honestly stated
 *      here, not hidden.
 *   4. Owner Language (Thai) — a real, MECHANICAL composition of layers
 *      1-3's own already-real fragments into Thai sentences, then passed
 *      once through ownerLanguage.ts's real sanitizeOwnerText() — exactly
 *      the same "compose real fragments, sanitize once, keep the raw
 *      technical detail in a separate drilldown field" pattern that file
 *      already established for Capability #57. Never a live LLM call per
 *      file — this file contains no LLM/AI-provider call of any kind.
 *
 * FOLDER SUMMARY — real aggregation over every real file registry/module-
 * registry.json registers under the given real directory prefix: how many
 * have a real, non-stub purpose vs. still carry the auto-stub (Guard 13's
 * own condition, reused verbatim, see above), plus real per-module OK/
 * BROKEN/UNUSED/UNREGISTERED counts pulled from registry/architecture-
 * book.json for exactly those same files. A file registered but absent
 * from the architecture-book graph is honestly counted separately
 * (`not_in_architecture_book`), never silently folded into one of the 4
 * real status buckets it doesn't actually have.
 *
 * HONESTY RULES (Constitution Rule 100/106/109/110 — this task's own
 * single most important rule): no layer here ever fabricates content a
 * real source doesn't actually provide. Every "undocumented" / "no
 * reference" / "not found" branch below is a real, deliberate, honestly-
 * labeled outcome — not a fallback masking a bug. This file is pure read/
 * compute only: zero writes, zero real money, zero external side effects,
 * zero LLM/AI-provider calls of any kind.
 *
 * WHAT THIS FILE NEVER TOUCHES: registry/CONSTITUTION.json, rule-
 * coverage.json, TASK_QUEUE.json, CHANGELOG.json, FACTORY_CENTRAL_
 * REGISTRY.json, capability-roadmap.json (read-only here, Manager owns
 * writes) — and it never edits systemRealityRuntime.ts, deadEndSweep
 * Runtime.ts, ownerLanguage.ts, or classification.ts; it only imports
 * their existing, unmodified exports.
 */
import { readFileSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import {
  buildSystemRealityModel, loadArchitectureBook,
  type ArchNode, type CapabilityRealityEntry, type FcrFinding, type SystemRealityModel,
} from "./systemRealityRuntime";
import { sanitizeOwnerText } from "@/app/api/admin/system-reality/_lib/ownerLanguage";
import { loadModuleRegistry, type ModuleRegistry } from "./classification";

const ROOT = WORKSPACE_ROOT;

// ============================================================
// Real auto-stub literal markers — exactly the same literal prefixes
// scripts/sync-registry.ts writes and Guard 13 (scripts/pre-commit-
// check.sh:327) checks. Kept here as named constants, not re-typed at
// every call site, but never a different regex from Guard 13's own real
// one.
// ============================================================
const AUTO_STUB_EN_PREFIX = "[Auto-detected]";
const AUTO_STUB_TH_PREFIX = "[ตรวจพบอัตโนมัติ]";

// ============================================================
// Small, real, local path helpers.
// ============================================================
function normalizeFilePath(input: string): string {
  let p = input.trim();
  if (p.startsWith("module:")) p = p.slice("module:".length);
  p = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  return p;
}
function toModuleId(relPath: string): string {
  return `module:${relPath}`;
}

// ============================================================
// Real, local (no existing wrapper — grep-verified before writing this
// file) reads for registry/FACTORY_CENTRAL_REGISTRY.json and registry/
// capability-roadmap.json — same "no existing wrapper, direct read"
// convention systemRealityRuntime.ts's and deadEndSweepRuntime.ts's own
// headers already document, applied here for the identical real reason.
// ============================================================
function tryReadJsonLocal<T>(relPath: string): T | null {
  try { return JSON.parse(readFileSync(path.join(ROOT, relPath), "utf-8")) as T; }
  catch { return null; }
}

interface FactoryCentralRegistryFile { findings: FcrFinding[] }
function loadFcrFindings(): FcrFinding[] {
  return tryReadJsonLocal<FactoryCentralRegistryFile>("registry/FACTORY_CENTRAL_REGISTRY.json")?.findings ?? [];
}

interface RoadmapCapability {
  number: number;
  name: string;
  status: string;
  done?: string;
  missing?: string;
  note?: string;
}
interface CapabilityRoadmapFile { capabilities: RoadmapCapability[] }
function loadRoadmapCapabilities(): RoadmapCapability[] {
  return tryReadJsonLocal<CapabilityRoadmapFile>("registry/capability-roadmap.json")?.capabilities ?? [];
}

// ============================================================
// LAYER 1 — Computer Language
// ============================================================
export interface ComputerLanguageLayer {
  file_path: string;
  module_id: string;
  found_in_architecture_book: boolean;
  found_in_module_registry: boolean;
  /** Real layer/owner — from registry/module-registry.json, falling back
   * to architecture-book.json's own `layer` field only for `layer` when
   * the module-registry entry is missing (both real, cited separately). */
  layer: string | null;
  owner: string | null;
  /** Real per-module structural status from registry/architecture-
   * book.json — OK/BROKEN/UNUSED/UNREGISTERED (or another real value that
   * schema allows) — kept named distinctly from module_registry_status
   * below, since the two registries use different, real, non-overlapping
   * status vocabularies (never conflated). */
  architecture_book_status: string | null;
  /** Real registry/module-registry.json own `status` field (e.g. "active"
   * / "unregistered") — a different real fact from architecture_book_status
   * above, kept separate on purpose. */
  module_registry_status: string | null;
  /** Real exports — architecture-book.json's own real node data carries an
   * `exports` array that systemRealityRuntime.ts's shared ArchNode type
   * doesn't declare (that file never needed it) but the real, underlying
   * JSON always does (grep-verified against a real node before writing
   * this file) — read here via a local, additive type widening, not a
   * second parse of the file. */
  exports: string[];
  dependents: string[];
  dependencies: string[];
  dependents_count: number;
  dependencies_count: number;
  disclosed_limitations: string[];
}

/** Real widening of the shared ArchNode type to read the `exports` field
 * that the real JSON always carries but systemRealityRuntime.ts's own
 * exported type doesn't declare (see field doc comment above). Additive
 * only — never redefines or shadows ArchNode itself. */
type ArchNodeWithExports = ArchNode & { exports?: string[] };

function buildComputerLanguageLayer(filePath: string, moduleId: string, registry: ModuleRegistry): ComputerLanguageLayer {
  const loaded = loadArchitectureBook();
  const node = (loaded?.byId.get(moduleId) as ArchNodeWithExports | undefined) ?? undefined;
  const regEntry = registry.modules[filePath];

  const disclosed: string[] = [];
  if (!loaded) {
    disclosed.push("registry/architecture-book.json could not be read/parsed at composition time — structural facts (exports/dependents/dependencies/architecture_book_status) honestly unavailable, reported null/empty, not guessed.");
  } else if (!node) {
    disclosed.push(`${moduleId} has no node in registry/architecture-book.json — this file is not (yet) part of the real, generated module graph; structural facts below are honestly unavailable, not guessed. (Same real, disclosed staleness class deadEndSweepRuntime.ts's own header names: a file created/registered after the last \`npx tsx scripts/sync-registry.ts && npx tsx scripts/build-arch-book.ts\` refresh is invisible here until that refresh runs again.)`);
  }
  if (!regEntry) {
    disclosed.push(`${filePath} has no entry in registry/module-registry.json — real layer/owner/module_registry_status facts below are honestly unavailable, not guessed.`);
  }

  return {
    file_path: filePath,
    module_id: moduleId,
    found_in_architecture_book: !!node,
    found_in_module_registry: !!regEntry,
    layer: regEntry?.layer ?? node?.layer ?? null,
    owner: regEntry?.owner ?? null,
    architecture_book_status: node?.status ?? null,
    module_registry_status: regEntry?.status ?? null,
    exports: node?.exports ?? [],
    dependents: node?.dependents ?? [],
    dependencies: node?.internal_dependencies ?? [],
    dependents_count: node?.dependents.length ?? 0,
    dependencies_count: node?.internal_dependencies.length ?? 0,
    disclosed_limitations: disclosed,
  };
}

// ============================================================
// LAYER 2 — AI Language
// ============================================================
export type AiLanguageState = "documented" | "not_yet_documented" | "not_registered";

export interface AiLanguageLayer {
  state: AiLanguageState;
  /** Light, mechanical reformat (trim/whitespace-collapse only) of the
   * real registry/module-registry.json `purpose` field — never a rewrite,
   * never an LLM call, null whenever state !== "documented". */
  description: string | null;
  /** Same real, mechanical reformat of the real `purpose_th` field, only
   * when it is ALSO real (not the Thai auto-stub) — kept independently of
   * `description`'s own state since this repo's real data was verified
   * (before writing this file) to always keep purpose/purpose_th stub-
   * status in agreement, but the two are still checked independently
   * here, never assumed to match. */
  description_th: string | null;
  source: string | null;
  reason: string;
}

function mechanicalReformat(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function buildAiLanguageLayer(filePath: string, registry: ModuleRegistry): AiLanguageLayer {
  const entry = registry.modules[filePath];
  if (!entry) {
    return {
      state: "not_registered",
      description: null,
      description_th: null,
      source: null,
      reason: `${filePath} has no entry at all in registry/module-registry.json (Constitution Rule 100 requires every real file to register there) — this is a real, honest registration gap, reported plainly, never invented around.`,
    };
  }
  const purpose = String(entry.purpose ?? "");
  const isStub = purpose.trim().length === 0 || purpose.startsWith(AUTO_STUB_EN_PREFIX);
  if (isStub) {
    return {
      state: "not_yet_documented",
      description: null,
      description_th: null,
      source: `registry/module-registry.json#modules["${filePath}"].purpose`,
      reason: `registry/module-registry.json's real purpose field for this file still carries the literal auto-generated stub ("${purpose || "(empty)"}") — no real, human-written description exists yet. Honestly reported as not yet documented; this layer never calls an LLM to invent one.`,
    };
  }
  const purposeTh = String(entry.purpose_th ?? "");
  const purposeThIsReal = purposeTh.trim().length > 0 && !purposeTh.startsWith(AUTO_STUB_TH_PREFIX);
  return {
    state: "documented",
    description: mechanicalReformat(purpose),
    description_th: purposeThIsReal ? mechanicalReformat(purposeTh) : null,
    source: `registry/module-registry.json#modules["${filePath}"].purpose`,
    reason: "real, already-written purpose field, lightly reformatted (trim/whitespace only) — not rewritten, not summarized by an LLM.",
  };
}

// ============================================================
// LAYER 3 — Business Language
// ============================================================
export type BusinessLanguageSource =
  | "systemRealityRuntime:capability"
  | "FACTORY_CENTRAL_REGISTRY:finding"
  | "capability-roadmap:capability";

export interface BusinessLanguageCitation {
  source: BusinessLanguageSource;
  id: string;
  /** The real, literal fragment of already-written text that contained
   * this file's own relative path — proof of the match, not a summary. */
  matched_text_excerpt: string;
  /** The real, already-written business-language text being reused
   * verbatim (never rewritten) from the matching capability/finding. */
  business_text: string;
  citation: string;
}

export interface BusinessLanguageLayer {
  referenced: boolean;
  citations: BusinessLanguageCitation[];
  reason: string;
}

function textMentionsFile(text: string | undefined | null, filePath: string): boolean {
  if (!text) return false;
  return text.includes(filePath);
}

function buildBusinessLanguageLayer(filePath: string, model: SystemRealityModel): BusinessLanguageLayer {
  const citations: BusinessLanguageCitation[] = [];

  // Source (a) — systemRealityRuntime.ts's own 17 real CapabilityRealityEntry
  // evidence[] arrays (Capability #57's own real, live-computed model).
  for (const cap of model.capabilities as CapabilityRealityEntry[]) {
    const hit = cap.evidence.find((e) => e.includes(filePath));
    if (hit) {
      citations.push({
        source: "systemRealityRuntime:capability",
        id: cap.capability_name,
        matched_text_excerpt: hit,
        business_text: cap.business_function,
        citation: `app/api/admin/ide/_lib/systemRealityRuntime.ts capability "${cap.capability_name}" evidence[]: "${hit}"`,
      });
    }
  }

  // Source (b) — registry/FACTORY_CENTRAL_REGISTRY.json findings' own real
  // description/evaluation text.
  for (const f of loadFcrFindings()) {
    const inDesc = textMentionsFile(f.description, filePath);
    const inEval = !inDesc && textMentionsFile(f.evaluation, filePath);
    if (inDesc || inEval) {
      const excerpt = inDesc ? (f.description as string) : (f.evaluation as string);
      citations.push({
        source: "FACTORY_CENTRAL_REGISTRY:finding",
        id: f.finding_id,
        matched_text_excerpt: excerpt,
        business_text: f.description ?? f.evaluation ?? "",
        citation: `registry/FACTORY_CENTRAL_REGISTRY.json ${f.finding_id} (status=${f.status})`,
      });
    }
  }

  // Source (c) — registry/capability-roadmap.json capabilities' own real
  // done/missing/note text.
  for (const cap of loadRoadmapCapabilities()) {
    const fields: Array<["done" | "missing" | "note", string | undefined]> = [
      ["done", cap.done], ["missing", cap.missing], ["note", cap.note],
    ];
    for (const [field, text] of fields) {
      if (textMentionsFile(text, filePath)) {
        citations.push({
          source: "capability-roadmap:capability",
          id: `#${cap.number} ${cap.name}`,
          matched_text_excerpt: text as string,
          business_text: text as string,
          citation: `registry/capability-roadmap.json capability #${cap.number} "${cap.name}".${field}`,
        });
        break; // one citation per roadmap capability is enough real signal.
      }
    }
  }

  if (citations.length === 0) {
    return {
      referenced: false,
      citations: [],
      reason: `real, literal-substring check of this file's own relative path ("${filePath}") against every real evidence[] string in systemRealityRuntime.ts's ${model.capabilities.length} real capabilities, every real finding's description/evaluation text in registry/FACTORY_CENTRAL_REGISTRY.json, and every real done/missing/note field in registry/capability-roadmap.json's capabilities found zero matches — honestly reported: no known business capability references this file yet.`,
    };
  }
  return {
    referenced: true,
    citations,
    reason: `${citations.length} real cross-reference(s) found across systemRealityRuntime.ts/FACTORY_CENTRAL_REGISTRY.json/capability-roadmap.json — cited verbatim below, not rewritten.`,
  };
}

// ============================================================
// LAYER 4 — Owner Language (Thai)
// ============================================================
export interface OwnerLanguageLayer {
  computer_summary_th: string;
  ai_summary_th: string;
  business_summary_th: string;
  /** Real, mechanical concatenation of the 3 sanitized fragments above —
   * the single top-level Owner-facing sentence for this file. */
  summary_th: string;
  drilldown: {
    computer_raw_th: string;
    ai_raw_th: string;
    business_raw_th: string;
  };
}

function buildOwnerLanguageLayer(
  computer: ComputerLanguageLayer, ai: AiLanguageLayer, business: BusinessLanguageLayer,
): OwnerLanguageLayer {
  const computerRawTh = `ไฟล์นี้อยู่ในชั้นสถาปัตยกรรม "${computer.layer ?? "ไม่ทราบ (ยังไม่มีข้อมูลจริง)"}" มีจุดเชื่อมต่อเข้ามาใช้งานจริง ${computer.dependents_count} จุด และเชื่อมต่อออกไปยังไฟล์อื่นจริง ${computer.dependencies_count} จุด`;

  const aiRawTh = ai.state === "documented"
    ? (ai.description_th ?? ai.description ?? "")
    : ai.state === "not_yet_documented"
      ? "ไฟล์นี้ยังไม่มีคำอธิบายจริงที่มนุษย์เขียนไว้ในระบบทะเบียน — ยังไม่มีการสรุปแบบข้อความลอยใด ๆ แทนคำอธิบายจริง"
      : "ไฟล์นี้ยังไม่ได้ลงทะเบียนไว้ในระบบทะเบียนกลางเลย";

  const businessRawTh = business.referenced
    ? `ไฟล์นี้เชื่อมโยงจริงกับความสามารถทางธุรกิจที่มีอยู่แล้วในระบบ: ${business.citations.map((c) => `${c.id} — ${c.business_text}`).join(" | ")}`
    : "ยังไม่มีความสามารถทางธุรกิจใดในระบบที่อ้างอิงไฟล์นี้ ณ ขณะนี้ — ไม่มีการสร้างเหตุผลทางธุรกิจขึ้นมาลอย ๆ";

  const computer_summary_th = sanitizeOwnerText(computerRawTh);
  const ai_summary_th = sanitizeOwnerText(aiRawTh);
  const business_summary_th = sanitizeOwnerText(businessRawTh);
  const summary_th = sanitizeOwnerText([computerRawTh, aiRawTh, businessRawTh].join(" "));

  return {
    computer_summary_th,
    ai_summary_th,
    business_summary_th,
    summary_th,
    drilldown: {
      computer_raw_th: computerRawTh,
      ai_raw_th: aiRawTh,
      business_raw_th: businessRawTh,
    },
  };
}

// ============================================================
// FileSummary — top-level, real, ON-DEMAND composition for ONE file.
// ============================================================
export interface FileSummary {
  file_path: string;
  generated_at: string;
  computer_language: ComputerLanguageLayer;
  ai_language: AiLanguageLayer;
  business_language: BusinessLanguageLayer;
  owner_language: OwnerLanguageLayer;
  disclosed_limitations: string[];
  sources_composed: string[];
}

const FILE_SUMMARY_SOURCES: string[] = [
  "registry/module-registry.json (via app/api/admin/ide/_lib/classification.ts#loadModuleRegistry)",
  "registry/architecture-book.json (via app/api/admin/ide/_lib/systemRealityRuntime.ts#loadArchitectureBook)",
  "app/api/admin/ide/_lib/systemRealityRuntime.ts#buildSystemRealityModel (capabilities[].evidence[], capabilities[].business_function)",
  "registry/FACTORY_CENTRAL_REGISTRY.json",
  "registry/capability-roadmap.json",
  "app/api/admin/system-reality/_lib/ownerLanguage.ts#sanitizeOwnerText",
];

export interface GetFileSummaryOptions {
  /** Optional, already-built SystemRealityModel — lets a caller composing
   * summaries for a small, explicit handful of files (e.g. this file's own
   * getFolderSummary composing over one folder's real files, or this
   * build's own acceptance test) avoid recomputing the same, cheap, fixed-
   * size (17-capability) model once per file. Never used to pre-compute
   * for all ~1000+ files — passing this does not change what is computed,
   * only how many times the (already inexpensive, verifyTestSuites-false-
   * by-default) model composition runs. */
  model?: SystemRealityModel;
}

/** THE real, on-demand File Summary — computed for exactly one real file
 * per call, never batched. Composes Layers 1-4 above purely from already-
 * real, already-structured sources; contains no LLM/AI-provider call. */
export async function getFileSummary(filePath: string, options: GetFileSummaryOptions = {}): Promise<FileSummary> {
  const normalized = normalizeFilePath(filePath);
  const moduleId = toModuleId(normalized);
  const registry = loadModuleRegistry();

  const computer = buildComputerLanguageLayer(normalized, moduleId, registry);
  const ai = buildAiLanguageLayer(normalized, registry);
  const model = options.model ?? await buildSystemRealityModel();
  const business = buildBusinessLanguageLayer(normalized, model);
  const owner = buildOwnerLanguageLayer(computer, ai, business);

  return {
    file_path: normalized,
    generated_at: new Date().toISOString(),
    computer_language: computer,
    ai_language: ai,
    business_language: business,
    owner_language: owner,
    disclosed_limitations: [...computer.disclosed_limitations],
    sources_composed: FILE_SUMMARY_SOURCES,
  };
}

// ============================================================
// FolderSummary — real aggregation over every real file registry/module-
// registry.json registers under the given real directory prefix.
// ============================================================
export interface FolderHealthCounts {
  ok: number;
  broken: number;
  unused: number;
  unregistered: number;
  /** Registered in module-registry.json but honestly absent from the
   * architecture-book.json graph — a real, distinct state from the 4
   * architecture-book status values above, never folded into one of them. */
  not_in_architecture_book: number;
}

export interface FolderPurposeExample {
  file_path: string;
  purpose: string;
}

export interface FolderSummary {
  dir_path: string;
  generated_at: string;
  file_count: number;
  documented_count: number;
  undocumented_count: number;
  /** A capped, real sample of files whose real purpose is non-stub — never
   * a synthesized single "what this folder does" paragraph (that would be
   * exactly the floating/unfounded summary this task forbids). */
  purpose_examples: FolderPurposeExample[];
  health: FolderHealthCounts;
  /** Real file paths still carrying the auto-stub / unregistered state —
   * Guard 13's own real condition (scripts/pre-commit-check.sh:327),
   * reused verbatim, not re-derived. */
  missing_files: string[];
  disclosed_limitations: string[];
  sources_composed: string[];
}

const FOLDER_SUMMARY_SOURCES: string[] = [
  "registry/module-registry.json (via app/api/admin/ide/_lib/classification.ts#loadModuleRegistry)",
  "registry/architecture-book.json (via app/api/admin/ide/_lib/systemRealityRuntime.ts#loadArchitectureBook)",
  "scripts/pre-commit-check.sh Guard 13 (stub-detection condition reused verbatim)",
];

const PURPOSE_EXAMPLES_CAP = 15;

/** THE real, on-demand Folder Summary — computed for exactly one real
 * directory prefix per call, never for the whole repo tree at once.
 * Iterates only the real files registry/module-registry.json already
 * registers under that prefix (never a filesystem walk of its own — this
 * file adds zero new directory-tree traversal, reusing the registry's own
 * already-complete real file list). */
export function getFolderSummary(dirPath: string): FolderSummary {
  const normalizedDir = normalizeFilePath(dirPath);
  const registry = loadModuleRegistry();
  const loaded = loadArchitectureBook();

  const filesInFolder = Object.keys(registry.modules).filter(
    (p) => p === normalizedDir || p.startsWith(`${normalizedDir}/`),
  );

  const missing_files: string[] = [];
  const purpose_examples: FolderPurposeExample[] = [];
  const health: FolderHealthCounts = { ok: 0, broken: 0, unused: 0, unregistered: 0, not_in_architecture_book: 0 };

  for (const p of filesInFolder) {
    const entry = registry.modules[p];

    // Guard 13's own real condition (scripts/pre-commit-check.sh:327),
    // reused verbatim:
    //   m.status === 'unregistered' || String(m.purpose_th || '').startsWith('[ตรวจพบอัตโนมัติ]')
    const isStub = entry.status === "unregistered" || String(entry.purpose_th ?? "").startsWith(AUTO_STUB_TH_PREFIX);
    if (isStub) {
      missing_files.push(p);
    } else if (!String(entry.purpose ?? "").startsWith(AUTO_STUB_EN_PREFIX) && purpose_examples.length < PURPOSE_EXAMPLES_CAP) {
      purpose_examples.push({ file_path: p, purpose: entry.purpose });
    }

    const node = loaded?.byId.get(toModuleId(p));
    if (!node) health.not_in_architecture_book++;
    else if (node.status === "OK") health.ok++;
    else if (node.status === "BROKEN") health.broken++;
    else if (node.status === "UNUSED") health.unused++;
    else if (node.status === "UNREGISTERED") health.unregistered++;
  }

  const disclosed: string[] = [];
  if (!loaded) disclosed.push("registry/architecture-book.json could not be read/parsed at composition time — every file in this folder is honestly counted under not_in_architecture_book, not guessed into OK/BROKEN/UNUSED/UNREGISTERED.");
  if (filesInFolder.length === 0) disclosed.push(`registry/module-registry.json has zero real entries under the prefix "${normalizedDir}" — either the folder does not exist, has no registered files, or the prefix was mistyped; this is honestly reported as an empty real result, never guessed.`);

  return {
    dir_path: normalizedDir,
    generated_at: new Date().toISOString(),
    file_count: filesInFolder.length,
    documented_count: filesInFolder.length - missing_files.length,
    undocumented_count: missing_files.length,
    purpose_examples,
    health,
    missing_files,
    disclosed_limitations: disclosed,
    sources_composed: FOLDER_SUMMARY_SOURCES,
  };
}
