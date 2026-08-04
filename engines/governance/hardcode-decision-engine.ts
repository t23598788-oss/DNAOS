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

const ROOT = join(__dirname, "..", "..");
const GOV_DIR = join(ROOT, "registry", "hardcode-governance");

function readJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(GOV_DIR, relPath), "utf-8"));
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
  | "UNKNOWN";

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

function loadKnownEntries() {
  const protocolConstants = readJSON<{ entries: any[] }>("protocol-constants-registry.json").entries;
  const platformConstraints = readJSON<{ entries: any[] }>("platform-constraint-registry.json").entries;
  const compileTimeConstants = readJSON<{ entries: any[] }>("approved-compile-time-constants.json").entries;
  const serviceEndpoints = readJSON<{ entries: any[] }>("service-endpoint-registry.json").entries;
  const hardwareProfiles = readJSON<{ device_profiles: any[] }>("hardware-profile-registry.json").device_profiles;
  return { protocolConstants, platformConstraints, compileTimeConstants, serviceEndpoints, hardwareProfiles };
}

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
  if (/model[_-]?(name|version)/i.test(context_key)) {
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
      evidence_required: compileMatch.source,
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

export function scanFile(filePath: string): Classification[] {
  const text = readFileSync(filePath, "utf-8");
  const lines = text.split("\n");
  const results: Classification[] = [];
  lines.forEach((lineText, idx) => {
    CANDIDATE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CANDIDATE_RE.exec(lineText))) {
      const [, , identifier, , literal] = m;
      if (!literal || literal.length < 3) continue;
      results.push(
        classify({ value: literal, context_key: identifier, file: filePath, line: idx + 1 })
      );
    }
  });
  return results;
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
