/**
 * Hardcode Decision Engine (HCG-P1).
 * registry/CURRENT_STATE.json plan_lock.exceptions_log -> HCG.
 *
 * Classifies a value found in source code into exactly one category from
 * registry/hardcode-governance/hardcode-policy-registry.json and returns a
 * verdict — never a blanket "no hardcode allowed" rule. UNKNOWN is always
 * blocked pending human review; this engine never guesses ALLOWED.
 *
 * Not wired into npm run guard/precommit/deploy-gate (HCG-P1 scope note) —
 * invoked on demand via the hardcode.* commands in command-registry.json.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { extractLiteralsAST } from "./ast-extractor";

// ROOT (owner fix 2026-10-08, found by real browser login test): `__dirname`
// inside the Next server bundle resolves to the bundle's own root ("/ROOT/…"),
// so every readJSON() here threw ENOENT in production — which silently broke
// identity.resolve for EVERY chat message (the pipeline's own lesson log showed
// "ENOENT /ROOT/registry/hardcode-governance/forbidden-hardcode-patterns.json").
// process.cwd() is the repo root in every real runtime of this code (container
// /app on Railway, project dir locally) — the same convention WORKSPACE_ROOT
// and every app/api/admin route already use.
const ROOT = process.cwd();
const GOV_DIR = join(ROOT, "registry", "hardcode-governance");

function readJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(GOV_DIR, relPath), "utf-8"));
}

function readRepoJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8"));
}

export type Category =
  | "FORBIDDEN_HARDCODE"
  | "REQUIRED_HARDCODE"
  | "PROTOCOL_CONSTANT"
  | "HARDWARE_CONSTANT"
  | "PLATFORM_CONSTRAINT"
  | "COMPILE_TIME_CONSTANT"
  | "CONFIGURABLE_VALUE"
  | "REGISTRY_VALUE"
  | "ENVIRONMENT_SECRET"
  | "BUSINESS_RULE"
  | "RUNTIME_RESOLVED_VALUE"
  | "UNKNOWN"
  | "MODULE_PATH"
  | "EVENT_NAME"
  | "COMMAND_NAME"
  | "SCHEMA_IDENTIFIER"
  | "UI_LITERAL"
  | "TEST_FIXTURE";

export type Verdict =
  | "ALLOWED"
  | "ALLOWED_WITH_REGISTRATION"
  | "MOVE_TO_CONFIG"
  | "MOVE_TO_REGISTRY"
  | "MOVE_TO_ENV"
  | "MOVE_TO_DATABASE"
  | "DUPLICATED_CONSTANT"
  | "SECURITY_VIOLATION"
  | "ARCHITECTURE_VIOLATION"
  | "UNKNOWN_REVIEW_REQUIRED";

export interface ScanHit {
  file: string;
  line: number;
  snippet: string;
}

export interface Classification {
  value: string;
  file: string;
  line: number;
  category: Category;
  verdict: Verdict;
  changes_by_environment: boolean;
  is_protocol_or_hardware_constant: boolean;
  should_live_in: "source_code" | "registry" | "config" | "env" | "database" | "human_review";
  allowed: boolean;
  move_to: string | null;
  evidence_required: string | null;
  rationale: string;
}

// ── Forbidden patterns (secrets, machine paths, business rules) ──

interface ForbiddenPattern {
  id: string;
  category: Category;
  pattern: string;
  verdict: Verdict;
  rationale: string;
}

function loadForbiddenPatterns(): ForbiddenPattern[] {
  return readJSON<{ entries: ForbiddenPattern[] }>("forbidden-hardcode-patterns.json").entries;
}

// ── Known-good registries (protocol/hardware/platform/compile-time/service) ──

// Real, minimal shapes matching exactly what this file reads from
// registry/hardcode-governance/*.json — never independently schema-
// validated, so these describe the fields actually accessed below, not a
// guessed full schema. protocolConstants/platformConstraints are loaded
// (and returned) but never field-accessed within classify() today, so
// their entries are honestly `unknown`, not a fabricated shape.
interface ServiceEndpointEntry { id?: string; category?: string; rationale: string }
interface HardwareProfileEntry { id?: string }
interface CompileTimeConstantEntry { value_type?: string; source?: string; rationale: string }

function loadKnownEntries() {
  const protocolConstants = readJSON<{ entries: unknown[] }>("protocol-constants-registry.json").entries;
  const platformConstraints = readJSON<{ entries: unknown[] }>("platform-constraint-registry.json").entries;
  const compileTimeConstants = readJSON<{ entries: CompileTimeConstantEntry[] }>("approved-compile-time-constants.json").entries;
  const serviceEndpoints = readJSON<{ entries: ServiceEndpointEntry[] }>("service-endpoint-registry.json").entries;
  const hardwareProfiles = readJSON<{ device_profiles: HardwareProfileEntry[] }>("hardware-profile-registry.json").device_profiles;
  return { protocolConstants, platformConstraints, compileTimeConstants, serviceEndpoints, hardwareProfiles };
}

// ── HCG Phase 2.7 — evidence-based cross-reference sources ──
// Loaded lazily + cached per-process; these are real registries already used
// elsewhere (command dispatch, event declarations, generated schema cache),
// never guessed from value shape alone.
let _eventNames: Set<string> | null = null;
function loadEventNames(): Set<string> {
  if (!_eventNames) {
    const events = readRepoJSON<{ events: Record<string, unknown> }>("registry/events.json");
    _eventNames = new Set(Object.keys(events.events));
  }
  return _eventNames;
}

let _commandNames: Set<string> | null = null;
function loadCommandNames(): Set<string> {
  if (!_commandNames) {
    const registry = readRepoJSON<{ commands: Record<string, unknown> }>("registry/command-registry.json");
    _commandNames = new Set(Object.keys(registry.commands));
  }
  return _commandNames;
}

let _schemaIdentifiers: Set<string> | null = null;
function loadSchemaIdentifiers(): Set<string> {
  if (!_schemaIdentifiers) {
    try {
      const cache = readJSON<{ tables: string[]; columns: string[] }>("schema-identifier-cache.json");
      _schemaIdentifiers = new Set([...cache.tables, ...cache.columns]);
    } catch {
      _schemaIdentifiers = new Set(); // cache not built yet — fail closed to "no match", never guess
    }
  }
  return _schemaIdentifiers;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const THAI_RANGE_RE = /[฀-๿]/;
const SECURITY_KEYWORD_RE = /key|token|secret|password|pwd|credential|authoriz|bearer|รหัส|ผ่าน/i;
// Defense-in-depth for UI_LITERAL (HCG Phase 2.8): a Bearer-shaped value should
// already be caught by FHP-BEARER-TOKEN-EMBEDDED (step 1, always wins first),
// but this is checked again here so UI_LITERAL never approves one even if the
// forbidden-pattern list is edited independently in the future.
const BEARER_VALUE_RE = /bearer\s+[A-Za-z0-9_\-.]{16,}/i;

// ── HTTP status codes are always PROTOCOL_CONSTANT (standard, fixed) ──
const HTTP_STATUS_CODES = new Set([
  100, 101, 200, 201, 202, 203, 204, 205, 206, 300, 301, 302, 303, 304, 307, 308,
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 422, 429,
  500, 501, 502, 503, 504, 505,
]);

const MIME_TYPE_RE = /^[a-z]+\/[a-z0-9.+-]+$/i;

/**
 * classify() — the core decision function. Never returns ALLOWED for an
 * unrecognized value; falls through to UNKNOWN_REVIEW_REQUIRED instead of
 * guessing.
 */
export function classify(input: {
  value: string;
  context_key?: string; // e.g. variable name, JSON key, or surrounding identifier
  file: string;
  line: number;
  layer?: "ui" | "route" | "business_logic" | "hardware" | "external_service" | "secret" | "unknown";
}): Classification {
  const { value, context_key = "", file, line } = input;
  const forbiddenPatterns = loadForbiddenPatterns();
  const known = loadKnownEntries();

  const base = { value, file, line };

  // 1. Forbidden patterns (secrets, connection strings, machine paths, business-rule-in-route) always win first.
  for (const p of forbiddenPatterns) {
    let re: RegExp;
    try {
      // Patterns are authored PCRE-style with a leading (?i) inline flag (as stored
      // in registry/hardcode-governance/forbidden-hardcode-patterns.json); JS RegExp
      // doesn't support inline (?i), so translate it to the case-insensitive flag.
      const caseInsensitive = p.pattern.startsWith("(?i)");
      const body = caseInsensitive ? p.pattern.slice(4) : p.pattern;
      re = new RegExp(body, caseInsensitive ? "i" : undefined);
    } catch {
      continue; // non-regex descriptive pattern (e.g. FHP-HARDCODED-PRICE-IN-ROUTE) — requires manual/AST check, not string match
    }
    if (re.test(value) || re.test(`${context_key}="${value}"`)) {
      return {
        ...base,
        category: p.category,
        verdict: p.verdict,
        changes_by_environment: true,
        is_protocol_or_hardware_constant: false,
        should_live_in: p.verdict === "SECURITY_VIOLATION" ? "env" : "human_review",
        allowed: false,
        move_to: p.verdict === "SECURITY_VIOLATION" ? "Environment Variable / Secret Provider" : "Policy or Config",
        evidence_required: null,
        rationale: p.rationale,
      };
    }
  }

  // 2. HTTP status code -> PROTOCOL_CONSTANT, always allowed.
  if (/^\d{3}$/.test(value) && HTTP_STATUS_CODES.has(Number(value))) {
    return {
      ...base,
      category: "PROTOCOL_CONSTANT",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: true,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "RFC 7231 reference (already in protocol-constants-registry.json)",
      rationale: "HTTP status codes are fixed by the HTTP standard, not configurable.",
    };
  }

  // 3. MIME type -> PROTOCOL_CONSTANT, allowed.
  if (MIME_TYPE_RE.test(value) && /^(application|text|image|audio|video|multipart|font)\//.test(value)) {
    return {
      ...base,
      category: "PROTOCOL_CONSTANT",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: true,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "IANA media types registry",
      rationale: "MIME types are IANA-registered standard values.",
    };
  }

  // 3b. HTTP method token -> PROTOCOL_CONSTANT, allowed. HCG Phase 2.7: found
  // live (23 real hits in critical-path files, e.g. supabase/functions/*)
  // falling through to UNKNOWN — the fixed 7-verb set is an RFC 7231
  // standard, exactly the REQUIRED_HARDCODE category this repo's own
  // hardcode-policy-registry.json already names ("HTTP status code" listed
  // alongside "standard header"; the verb set is the same class of value).
  if (HTTP_METHODS.has(value)) {
    return {
      ...base,
      category: "PROTOCOL_CONSTANT",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: true,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "RFC 7231 §4 (HTTP request methods)",
      rationale: "HTTP method tokens (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) are fixed by the HTTP standard.",
    };
  }

  // 4. Environment-dependent URL/domain -> CONFIGURABLE_VALUE, move to config/env.
  if (/^https?:\/\//.test(value)) {
    const known_endpoint = known.serviceEndpoints.find((e) => value.includes(new URL(withProtocol(value)).hostname) || e.id);
    const providerFixed = known.serviceEndpoints.find(
      (e) => e.category === "PROTOCOL_CONSTANT" && value.startsWith("https://api.line.me")
    );
    if (providerFixed) {
      return {
        ...base,
        category: "PROTOCOL_CONSTANT",
        verdict: "ALLOWED_WITH_REGISTRATION",
        changes_by_environment: false,
        is_protocol_or_hardware_constant: true,
        should_live_in: "source_code",
        allowed: true,
        move_to: null,
        evidence_required: "provider docs stating the endpoint is fixed (see service-endpoint-registry.json)",
        rationale: providerFixed.rationale,
      };
    }
    return {
      ...base,
      category: "CONFIGURABLE_VALUE",
      verdict: "MOVE_TO_ENV",
      changes_by_environment: true,
      is_protocol_or_hardware_constant: false,
      should_live_in: "env",
      allowed: false,
      move_to: "Environment Variable (see service-endpoint-registry.json for the matching entry, or add one)",
      evidence_required: null,
      rationale: "URL/endpoint that is not documented as provider-fixed must be assumed environment-dependent until proven otherwise.",
    };
  }

  // 5. GPIO / pin-map style keys.
  if (/gpio|pin[_-]?map/i.test(context_key)) {
    const fixedBoard = known.hardwareProfiles.find((h) => h.id && value === h.id);
    if (/board|model|rev/i.test(context_key) === false) {
      return {
        ...base,
        category: "HARDWARE_CONSTANT",
        verdict: known.hardwareProfiles.length > 0 ? "ALLOWED_WITH_REGISTRATION" : "MOVE_TO_REGISTRY",
        changes_by_environment: false,
        is_protocol_or_hardware_constant: true,
        should_live_in: known.hardwareProfiles.length > 0 ? "source_code" : "registry",
        allowed: known.hardwareProfiles.length > 0,
        move_to: known.hardwareProfiles.length > 0 ? null : "hardware-profile-registry.json (device_profiles)",
        evidence_required: "manufacturer datasheet / board revision id",
        rationale: "GPIO pin bound to one fixed board revision is HARDWARE_CONSTANT; if it varies by model it must move to the hardware profile registry instead.",
      };
    }
  }

  // 6. Model name / model version -> REGISTRY_VALUE, move to registry (FORBIDDEN_HARDCODE list).
  // HCG Phase 2.7 fix: was /model[_-]?(name|version)/i, which missed the real,
  // common pattern `const MODEL = "claude-..."` (bare "MODEL", no suffix) —
  // confirmed live in services/ai/bridge-claude.ts and 2 other files, all
  // previously falling through to UNKNOWN. Broadened with a word boundary so
  // bare "model"/"MODEL" now matches too, without also matching unrelated
  // identifiers that merely contain "model" as a substring (e.g. "modelData"
  // still matches, correctly, since it IS model-related; something like
  // "sedimentology" would not, since \b requires a real word boundary).
  if (/\bmodel([_-]?(name|version))?\b/i.test(context_key)) {
    return {
      ...base,
      category: "FORBIDDEN_HARDCODE",
      verdict: "MOVE_TO_REGISTRY",
      changes_by_environment: true,
      is_protocol_or_hardware_constant: false,
      should_live_in: "registry",
      allowed: false,
      move_to: "a model/service registry (e.g. registry/services.json or a dedicated model registry)",
      evidence_required: null,
      rationale: "Model name/version changes across providers and time; must be centrally registered, not inlined.",
    };
  }

  // 7. Threshold / price / timeout / retry -> BUSINESS_RULE or CONFIGURABLE_VALUE.
  if (/threshold|price|ราคา|timeout|retry/i.test(context_key)) {
    const inBusinessLayer = input.layer === "business_logic" || input.layer === "route" || input.layer === "ui";
    return {
      ...base,
      category: "BUSINESS_RULE",
      verdict: inBusinessLayer ? "MOVE_TO_DATABASE" : "MOVE_TO_CONFIG",
      changes_by_environment: true,
      is_protocol_or_hardware_constant: false,
      should_live_in: inBusinessLayer ? "database" : "config",
      allowed: false,
      move_to: inBusinessLayer ? "Database / Policy Engine (business threshold/price)" : "Configuration Provider",
      evidence_required: null,
      rationale: "Business-facing threshold/price/timeout/retry must be adjustable without a code deploy.",
    };
  }

  // 8. Compile-time enum / math constant explicitly approved.
  const compileMatch = known.compileTimeConstants.find((c) => c.value_type && context_key && new RegExp(c.value_type.replace(/_/g, "[_ ]?"), "i").test(context_key));
  if (compileMatch) {
    return {
      ...base,
      category: "COMPILE_TIME_CONSTANT",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: true,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: compileMatch.source ?? null,
      rationale: compileMatch.rationale,
    };
  }

  // 9. Machine-specific absolute path already caught by forbidden patterns above; explicit fallback here for safety.
  if (/^(\/Users\/|C:\\\\Users\\\\)/.test(value)) {
    return {
      ...base,
      category: "FORBIDDEN_HARDCODE",
      verdict: "ARCHITECTURE_VIOLATION",
      changes_by_environment: true,
      is_protocol_or_hardware_constant: false,
      should_live_in: "config",
      allowed: false,
      move_to: "relative path resolved at runtime, or Environment Variable",
      evidence_required: null,
      rationale: "Absolute machine-specific path breaks portability across dev machines/CI/prod.",
    };
  }

  // 10. HCG Phase 2.7 — evidence-based structural-constant categories.
  // Every one of these cross-references a real registry/generated cache or
  // uses a narrow, non-guessable shape rule; none infer meaning from value
  // content alone where context could be more precise (per the owner's own
  // instruction). Ordered after all security/business-rule checks above, so
  // none of these can ever override a real secret or business value — this
  // step only runs once nothing more specific already matched.

  // 10a. Module/import path (relative or @-aliased specifier, no protocol, no whitespace).
  if (/^(\.\.?\/|@\/)[\w\-./]+$/.test(value)) {
    return {
      ...base,
      category: "MODULE_PATH",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: false,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "shape only (relative/@-aliased import specifier) — see hardcode-policy-registry.json MODULE_PATH",
      rationale: "Module import path — structural to the module system, resolved at build/bundle time, not a business or protocol value.",
    };
  }

  // 10b. Command name — must be a REAL registered command (registry/command-registry.json), never guessed from dot.case shape alone.
  if (/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(value) && loadCommandNames().has(value)) {
    return {
      ...base,
      category: "COMMAND_NAME",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: false,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "registry/command-registry.json (exact key match, cross-referenced — not guessed from shape)",
      rationale: "Registered command name — the same source engines/validation/dispatcher.ts's isRegistered() checks against.",
    };
  }

  // 10c. Event name — must be a REAL registered event (registry/events.json), never guessed from dot.case shape alone.
  if (/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(value) && loadEventNames().has(value)) {
    return {
      ...base,
      category: "EVENT_NAME",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: false,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "registry/events.json (exact key match, cross-referenced — not guessed from shape)",
      rationale: "Registered event-type name.",
    };
  }

  // 10d. Schema identifier — snake_case WITH an underscore (excludes ambiguous single
  // dictionary words that happen to collide with a column name elsewhere) AND
  // present in the generated migration-derived cache.
  if (/^[a-z][a-z0-9_]*$/.test(value) && value.includes("_") && loadSchemaIdentifiers().has(value)) {
    return {
      ...base,
      category: "SCHEMA_IDENTIFIER",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: false,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "registry/hardcode-governance/schema-identifier-cache.json, generated from supabase/migrations/*.sql",
      rationale: "Real table/column identifier from the live schema — structural metadata, not a business value or credential.",
    };
  }

  // 10e. UI/log/error text — contains whitespace or Thai script (never a machine
  // identifier/business key/credential in this codebase's real conventions),
  // with a defensive security-keyword exclusion since the forbidden-pattern
  // list (step 1) is English-keyword-only today.
  if (
    (value.includes(" ") || THAI_RANGE_RE.test(value)) &&
    value.length >= 4 &&
    !SECURITY_KEYWORD_RE.test(context_key) &&
    !BEARER_VALUE_RE.test(value) &&
    !value.includes("${")
  ) {
    return {
      ...base,
      category: "UI_LITERAL",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: false,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "shape only (whitespace/Thai-script presence) + security-keyword exclusion — see hardcode-policy-registry.json UI_LITERAL",
      rationale: "Human-readable display/log/error text — conveys meaning to a reader, not a machine-consumed threshold, price, or credential.",
    };
  }

  // 10f. Test fixture — file path under a test/fixture location. Forbidden-pattern
  // check (step 1) already ran and would have won if this looked like a real secret.
  if (/\.(test|spec)\.tsx?$/.test(file) || /__tests__|__fixtures__|\/fixtures\//.test(file)) {
    return {
      ...base,
      category: "TEST_FIXTURE",
      verdict: "ALLOWED",
      changes_by_environment: false,
      is_protocol_or_hardware_constant: false,
      should_live_in: "source_code",
      allowed: true,
      move_to: null,
      evidence_required: "file-path shape only (test/fixture location)",
      rationale: "Test fixture data — exercises code paths in isolation, never governs real runtime business behavior.",
    };
  }

  // Nothing matched confidently -> UNKNOWN. Never guess ALLOWED.
  return {
    ...base,
    category: "UNKNOWN",
    verdict: "UNKNOWN_REVIEW_REQUIRED",
    changes_by_environment: false,
    is_protocol_or_hardware_constant: false,
    should_live_in: "human_review",
    allowed: false,
    move_to: null,
    evidence_required: "human classification required before this value may be treated as allowed",
    rationale: "Engine could not confidently match this value against any known category or pattern.",
  };
}

function withProtocol(v: string) {
  return v;
}

/**
 * scan() — walk a file or directory, extract candidate literal values, and
 * classify each one. Extraction is heuristic (string/number literals near
 * suspicious identifier names) — not a full AST parse.
 */
const CANDIDATE_RE = /(const|let|var)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(['"`])((?:(?!\3).)*)\3/g;

/**
 * Bare (unquoted) numeric literals — found missing during HCG Phase 2.5
 * stabilization: `const debt_threshold = 5000;` / `const timeout = 30000;` /
 * `const ราคา = 1500;` were completely invisible to CANDIDATE_RE (which only
 * matches quoted string/template values), so 3 of the owner's own 10 required
 * test cases (HTTP status, threshold, price) silently passed through unseen
 * by both the pre-commit dry-run and the AI hook. Deliberately scoped to
 * identifier names that already carry business/protocol meaning in
 * classify()'s own logic (threshold/price/ราคา/timeout/retry/status/code) —
 * an unscoped bare-number match would flood every array index, loop bound,
 * and layout constant in the codebase with noise on top of the existing
 * 99.4% UNKNOWN ratio already flagged in the stabilization report.
 */
const NUMERIC_CANDIDATE_RE =
  /(const|let|var)?\s*([A-Za-z_฀-๿][A-Za-z0-9_฀-๿]*)\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*[;,)\n]/g;
const NUMERIC_SUSPICIOUS_KEY_RE = /threshold|price|ราคา|timeout|retry|status|statuscode|code|limit|max|min|rate|fee|amount|quota/i;

/**
 * scanTextRegex() — the original HCG-P1..2.7 regex-based extractor. Kept as
 * the fallback for non-TS/TSX text (the AST extractor below requires valid
 * TypeScript syntax). Superseded by scanTextAST() for .ts/.tsx files as of
 * HCG Phase 2.8 — see engines/governance/ast-extractor.ts's own doc comment
 * for why (a real, confirmed bug: this regex walk read raw text line-by-line
 * and could tear a single multi-line template-literal's prose apart into
 * spurious sub-matches, which a real parser structurally cannot do).
 */
function scanTextRegex(text: string, virtualPath: string): Classification[] {
  const lines = text.split("\n");
  const results: Classification[] = [];
  lines.forEach((lineText, idx) => {
    CANDIDATE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CANDIDATE_RE.exec(lineText))) {
      const [, , identifier, , literal] = m;
      if (!literal || literal.length < 3) continue;
      results.push(
        classify({ value: literal, context_key: identifier, file: virtualPath, line: idx + 1 })
      );
    }

    NUMERIC_CANDIDATE_RE.lastIndex = 0;
    let nm: RegExpExecArray | null;
    while ((nm = NUMERIC_CANDIDATE_RE.exec(lineText))) {
      const [, , identifier, numLiteral] = nm;
      if (!identifier || !NUMERIC_SUSPICIOUS_KEY_RE.test(identifier)) continue;
      results.push(
        classify({ value: numLiteral, context_key: identifier, file: virtualPath, line: idx + 1 })
      );
    }
  });
  return results;
}

/**
 * scanTextAST() — HCG Phase 2.8. Real AST-based extraction via the
 * TypeScript compiler API (engines/governance/ast-extractor.ts), covering
 * positions the regex extractor structurally could not see: function
 * arguments, array elements, return values, comparison/conditional
 * expressions, import/export module specifiers, and (via the sibling-arg
 * special case) Supabase-style query-builder calls like `.eq("status",
 * "OPEN")` where arg0 supplies real context for arg1. String/template
 * literals are classified unconditionally (same as before); numeric
 * literals are still filtered to NUMERIC_SUSPICIOUS_KEY_RE-matching context
 * to avoid flooding on loop counters/array indices/return-code zeros (a
 * real, measured problem — see HCG Phase 2.7/2.8 reports).
 */
function scanTextAST(text: string, virtualPath: string): Classification[] {
  const hits = extractLiteralsAST(text, virtualPath);
  const results: Classification[] = [];
  for (const h of hits) {
    const isNumeric = h.is_numeric;
    if (isNumeric && !NUMERIC_SUSPICIOUS_KEY_RE.test(h.context_key)) continue;
    if (h.value.length < 3 && !isNumeric) continue; // same minimum-length noise guard as the regex path
    results.push(classify({ value: h.value, context_key: h.context_key, file: h.file, line: h.line }));
  }
  return results;
}

/**
 * scanText() — same extraction/classify logic as scanFile(), against raw text
 * that hasn't been written to disk yet. Used by the AI Code Generation
 * PreToolUse hook (HCG-P2), which receives new/edited content on stdin
 * before the Write/Edit tool call is allowed to proceed. Routes to the AST
 * extractor for .ts/.tsx (HCG Phase 2.8); falls back to the regex extractor
 * for anything else (e.g. content whose virtual path doesn't end in .ts/.tsx,
 * or genuinely invalid syntax the parser can't handle — fails open to the
 * older, less precise but always-available path rather than throwing).
 */
export function scanText(text: string, virtualPath: string): Classification[] {
  if (virtualPath.endsWith(".ts") || virtualPath.endsWith(".tsx")) {
    try {
      return scanTextAST(text, virtualPath);
    } catch {
      return scanTextRegex(text, virtualPath);
    }
  }
  return scanTextRegex(text, virtualPath);
}

export function scanFile(filePath: string): Classification[] {
  return scanText(readFileSync(filePath, "utf-8"), filePath);
}

export function scanRepository(dir: string, extensions = [".ts", ".tsx"]): Classification[] {
  const results: Classification[] = [];
  const IGNORE = new Set(["node_modules", ".next", ".git", "dist", "build"]);
  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      if (IGNORE.has(entry)) continue;
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (extensions.includes(extname(entry))) results.push(...scanFile(full));
    }
  }
  walk(dir);
  return results;
}

/**
 * findDuplicates() — same literal value appearing across >1 file, flagged
 * DUPLICATED_CONSTANT regardless of individual verdict.
 */
export function findDuplicates(classifications: Classification[]): Record<string, Classification[]> {
  const byValue: Record<string, Classification[]> = {};
  for (const c of classifications) {
    if (c.category === "UNKNOWN") continue;
    byValue[c.value] = byValue[c.value] || [];
    byValue[c.value].push(c);
  }
  const dupes: Record<string, Classification[]> = {};
  for (const [value, hits] of Object.entries(byValue)) {
    const files = new Set(hits.map((h) => h.file));
    if (files.size > 1) dupes[value] = hits;
  }
  return dupes;
}

export function explain(c: Classification): string {
  return [
    `Value: "${c.value}" (${c.file}:${c.line})`,
    `Category: ${c.category}`,
    `Changes by environment: ${c.changes_by_environment ? "yes" : "no"}`,
    `Protocol/hardware constant: ${c.is_protocol_or_hardware_constant ? "yes" : "no"}`,
    `Should live in: ${c.should_live_in}`,
    `Allowed to hardcode: ${c.allowed ? "yes" : "no"}`,
    c.move_to ? `Move to: ${c.move_to}` : null,
    c.evidence_required ? `Evidence required: ${c.evidence_required}` : null,
    `Verdict: ${c.verdict}`,
    `Rationale: ${c.rationale}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface MigrationPlanItem {
  value: string;
  file: string;
  line: number;
  verdict: Verdict;
  action: string;
}

export function generateMigrationPlan(classifications: Classification[]): MigrationPlanItem[] {
  return classifications
    .filter((c) => c.verdict !== "ALLOWED" && c.verdict !== "ALLOWED_WITH_REGISTRATION")
    .map((c) => ({
      value: c.value,
      file: c.file,
      line: c.line,
      verdict: c.verdict,
      action:
        c.verdict === "UNKNOWN_REVIEW_REQUIRED"
          ? "Block — request human classification, then re-run hardcode.classify."
          : `Move to ${c.should_live_in}${c.move_to ? ` (${c.move_to})` : ""}.`,
    }));
}

export interface ScanReport {
  files_scanned: number;
  values_found: number;
  allowed: Classification[];
  must_move: Classification[];
  must_register: Classification[];
  duplicates: Record<string, Classification[]>;
  unknown: Classification[];
  migration_plan: MigrationPlanItem[];
}

export function buildReport(classifications: Classification[], filesScanned: number): ScanReport {
  const duplicates = findDuplicates(classifications);
  return {
    files_scanned: filesScanned,
    values_found: classifications.length,
    allowed: classifications.filter((c) => c.verdict === "ALLOWED"),
    must_move: classifications.filter((c) =>
      ["MOVE_TO_CONFIG", "MOVE_TO_REGISTRY", "MOVE_TO_ENV", "MOVE_TO_DATABASE"].includes(c.verdict)
    ),
    must_register: classifications.filter((c) => c.verdict === "ALLOWED_WITH_REGISTRATION"),
    duplicates,
    unknown: classifications.filter((c) => c.verdict === "UNKNOWN_REVIEW_REQUIRED"),
    migration_plan: generateMigrationPlan(classifications),
  };
}

/**
 * verifyExternalConstraint() — section 3/4 checklist for a service/hardware
 * value: does the provider force a fixed endpoint, does it vary by region,
 * is there an official SDK/discovery endpoint, is the API versioned.
 */
export interface ExternalConstraintCheck {
  provider: string;
  endpoint_forced_fixed: boolean;
  varies_by_region_or_env: boolean;
  has_official_sdk_or_discovery: boolean;
  is_versioned_api: boolean;
  verdict: "PROTOCOL_CONSTANT" | "CONFIGURABLE_VALUE" | "UNKNOWN_REVIEW_REQUIRED";
}

export function verifyExternalConstraint(input: {
  provider: string;
  endpoint_forced_fixed?: boolean;
  varies_by_region_or_env?: boolean;
  has_official_sdk_or_discovery?: boolean;
  is_versioned_api?: boolean;
}): ExternalConstraintCheck {
  const {
    provider,
    endpoint_forced_fixed = false,
    varies_by_region_or_env = false,
    has_official_sdk_or_discovery = false,
    is_versioned_api = false,
  } = input;
  let verdict: ExternalConstraintCheck["verdict"] = "UNKNOWN_REVIEW_REQUIRED";
  if (varies_by_region_or_env) verdict = "CONFIGURABLE_VALUE";
  else if (endpoint_forced_fixed) verdict = "PROTOCOL_CONSTANT";
  return {
    provider,
    endpoint_forced_fixed,
    varies_by_region_or_env,
    has_official_sdk_or_discovery,
    is_versioned_api,
    verdict,
  };
}

export interface RegisteredException {
  id: string;
  value_or_pattern: string;
  category: Category;
  registered_by: string;
  reason: string;
  registered_at: string;
}

/**
 * registerException() — returns the record to append to
 * forbidden-hardcode-patterns.json / the relevant registry; this function
 * does NOT write the file itself (write is a human/CI-reviewed step, per
 * "review_required" on every registry entry).
 */
export function registerException(input: {
  value_or_pattern: string;
  category: Category;
  registered_by: string;
  reason: string;
}): RegisteredException {
  return {
    id: `HCG-EXC-${Date.now()}`,
    ...input,
    registered_at: new Date().toISOString().slice(0, 10),
  };
}
