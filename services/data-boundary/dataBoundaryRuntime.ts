/**
 * Data Boundary Integrity Gate (owner, 2026-08-09). The ONE canonical,
 * shared runtime layer for detecting silent semantic corruption when
 * data crosses a JSON/API/Queue/Worker/Storage boundary — used by
 * Document, Finance, LINE/Event, Worker/Factory, API, and
 * Artifact/Evidence paths. Not a new subsystem per domain.
 *
 * Reuse investigation (before writing this file): `services/` has no
 * existing data-boundary layer. `app/api/admin/ide/_lib/
 * factoryCompletionRuntime.ts` exports `DataBoundaryClaim` /
 * `computeDataBoundaryAudit()`, but that is a self-audit REPORT
 * generator over the existing codebase (PROVEN/PARTIAL/UNKNOWN claims
 * about code that already exists) — a completely different concern
 * from this file, which is a runtime VALIDATION/ENCODING gate that
 * actually intercepts values at real boundaries. No duplicate.
 *
 * Scope discipline: this gate never judges whether Document, Finance,
 * LINE, or Worker business logic is correct. It only ever answers one
 * of four questions about the SHAPE of data at a boundary:
 * PASS_IN_SCOPE / FAIL_IN_SCOPE / INSUFFICIENT_EVIDENCE / OUT_OF_SCOPE.
 *
 * Money: this repo has no canonical exact-decimal type (no decimal.js /
 * big.js / bignumber.js dependency; Document/Finance engines currently
 * use plain `number`). Per the owner mandate, this gate does NOT invent
 * a project-wide Money type — it defines and enforces its own strict
 * WIRE contract (fixed-point decimal string, BigInt minor-unit
 * conversion, zero float parsing) at the boundary only. Adopting a
 * business-wide exact Money type across Document/Finance engines is
 * BLOCKED on a separate, larger decision — see the
 * DATA_BOUNDARY_INTEGRITY_REPORT for this limitation.
 *
 * Fail-closed: any boundary call that cannot prove semantic integrity
 * (FAIL_IN_SCOPE or INSUFFICIENT_EVIDENCE) throws
 * DataIntegrityBoundaryFailure. Callers must not catch-and-coerce; a
 * caught failure must propagate as a real error to the caller's caller.
 */

// ---------------------------------------------------------------------
// Failure contract
// ---------------------------------------------------------------------

export type BoundaryId =
  | "API_INPUT"
  | "API_OUTPUT"
  | "EVENT_INTAKE"
  | "WORKER_REQUEST"
  | "WORKER_RESPONSE"
  | "QUEUE_ARTIFACT_EVIDENCE"
  | "DOCUMENT_FINANCE_WRITE";

export type BoundaryVerdict =
  | "PASS_IN_SCOPE"
  | "FAIL_IN_SCOPE"
  | "INSUFFICIENT_EVIDENCE"
  | "OUT_OF_SCOPE";

export interface BoundaryEvidenceEntry {
  boundary: BoundaryId;
  path: string;
  expectedType: string;
  receivedType: string;
  reason: string;
  correlationId: string | null;
}

export const DATA_INTEGRITY_BOUNDARY_FAILURE = "DATA_INTEGRITY_BOUNDARY_FAILURE" as const;

export class DataIntegrityBoundaryFailure extends Error {
  readonly code = DATA_INTEGRITY_BOUNDARY_FAILURE;
  readonly evidence: BoundaryEvidenceEntry[];

  constructor(evidence: BoundaryEvidenceEntry[]) {
    const first = evidence[0];
    super(
      `${DATA_INTEGRITY_BOUNDARY_FAILURE}: ${evidence.length} violation(s) at boundary=${first?.boundary ?? "UNKNOWN"} path=${first?.path ?? "$"} reason=${first?.reason ?? "unknown"}`
    );
    this.name = "DataIntegrityBoundaryFailure";
    this.evidence = evidence;
  }
}

export interface BoundaryOutcome<T> {
  verdict: BoundaryVerdict;
  value: T | null;
  evidence: BoundaryEvidenceEntry[];
}

// ---------------------------------------------------------------------
// Contract DSL — declares the expected semantic type of every field
// that crosses a boundary. There is no "trust the JSON shape" default:
// anything not declared is walked by the undeclared-exotic scanner
// (Map/Set/BigInt/Date/undefined-in-array) so those can never pass
// silently even inside an "unknown" region.
// ---------------------------------------------------------------------

export type PatchState<T> =
  | { tag: "UNCHANGED" }
  | { tag: "SET"; value: T }
  | { tag: "CLEAR" };

export type FieldContract =
  | { kind: "longId" }
  | { kind: "money"; scale?: number }
  | { kind: "date"; encoding: "ISO8601_STRING" | "UNIX_MS" | "UNIX_SECONDS" }
  | { kind: "patch"; of: FieldContract }
  | { kind: "map"; of: FieldContract }
  | { kind: "set"; of: FieldContract }
  | { kind: "bigint" }
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "literal"; value: string }
  | { kind: "nullable"; of: FieldContract }
  | { kind: "array"; of: FieldContract }
  | { kind: "object"; fields: Record<string, FieldContract>; required: string[] }
  | { kind: "unknown" };

// ---------------------------------------------------------------------
// Precision-preserving JSON text decode. `JSON.parse` / `Request.json()`
// silently round unsafe integer literals to the nearest representable
// double BEFORE any of our code ever sees the value — by the time a
// caller has a parsed object, 9007199254740993 has already become
// 9007199254740992. There is no way to detect that after the fact, so
// callers at API_INPUT / EVENT_INTAKE / WORKER_RESPONSE MUST hand this
// gate the raw text (e.g. `await request.text()`, never
// `await request.json()`) for LONG_ID protection to be real rather than
// theoretical.
// ---------------------------------------------------------------------

const UNSAFE_INT_TAG = "__dataBoundaryUnsafeInt__" as const;
interface UnsafeIntSentinel {
  [UNSAFE_INT_TAG]: true;
  digits: string;
}
function isUnsafeIntSentinel(v: unknown): v is UnsafeIntSentinel {
  return typeof v === "object" && v !== null && (v as Record<string, unknown>)[UNSAFE_INT_TAG] === true;
}

class JsonTextParseError extends Error {}

/**
 * Minimal recursive-descent JSON parser. Behaves exactly like
 * `JSON.parse` except: an integer literal (no `.`, no exponent) whose
 * magnitude exceeds `Number.MAX_SAFE_INTEGER` is NOT converted to a
 * lossy `number` — it is preserved as an `UnsafeIntSentinel` carrying
 * the exact original digit string, so the contract layer above can
 * decide (LONG_ID → accept as string; anything else → FAIL_IN_SCOPE).
 */
export function parseJsonPreservingPrecision(text: string): unknown {
  let i = 0;
  const n = text.length;

  function skipWs() {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  }
  function fail(msg: string): never {
    throw new JsonTextParseError(`${msg} at offset ${i}`);
  }
  function parseValue(): unknown {
    skipWs();
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "t") { expectLit("true"); return true; }
    if (c === "f") { expectLit("false"); return false; }
    if (c === "n") { expectLit("null"); return null; }
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    fail(`unexpected token '${c}'`);
  }
  function expectLit(lit: string) {
    if (text.slice(i, i + lit.length) !== lit) fail(`expected literal ${lit}`);
    i += lit.length;
  }
  function parseObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    i++; // {
    skipWs();
    if (text[i] === "}") { i++; return obj; }
    for (;;) {
      skipWs();
      if (text[i] !== '"') fail("expected string key");
      const key = parseString();
      skipWs();
      if (text[i] !== ":") fail("expected ':'");
      i++;
      obj[key] = parseValue();
      skipWs();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; break; }
      fail("expected ',' or '}'");
    }
    return obj;
  }
  function parseArray(): unknown[] {
    const arr: unknown[] = [];
    i++; // [
    skipWs();
    if (text[i] === "]") { i++; return arr; }
    for (;;) {
      arr.push(parseValue());
      skipWs();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; break; }
      fail("expected ',' or ']'");
    }
    return arr;
  }
  function parseString(): string {
    i++; // opening quote
    let out = "";
    while (true) {
      if (i >= n) fail("unterminated string");
      const c = text[i];
      if (c === '"') { i++; break; }
      if (c === "\\") {
        const esc = text[i + 1];
        if (esc === '"') { out += '"'; i += 2; }
        else if (esc === "\\") { out += "\\"; i += 2; }
        else if (esc === "/") { out += "/"; i += 2; }
        else if (esc === "b") { out += "\b"; i += 2; }
        else if (esc === "f") { out += "\f"; i += 2; }
        else if (esc === "n") { out += "\n"; i += 2; }
        else if (esc === "r") { out += "\r"; i += 2; }
        else if (esc === "t") { out += "\t"; i += 2; }
        else if (esc === "u") {
          const hex = text.slice(i + 2, i + 6);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else fail(`invalid escape '\\${esc}'`);
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }
  function parseNumber(): number | UnsafeIntSentinel {
    const start = i;
    if (text[i] === "-") i++;
    while (i < n && text[i] >= "0" && text[i] <= "9") i++;
    let isFloatOrExp = false;
    if (text[i] === ".") {
      isFloatOrExp = true;
      i++;
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      isFloatOrExp = true;
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
    }
    const raw = text.slice(start, i);
    if (raw === "" || raw === "-") fail("invalid number");
    if (!isFloatOrExp) {
      const digits = raw[0] === "-" ? raw.slice(1) : raw;
      const isSafe =
        digits.length < 16 ||
        (digits.length === 16 && BigInt(raw) >= BigInt("-9007199254740991") && BigInt(raw) <= BigInt("9007199254740991"));
      if (!isSafe) {
        return { [UNSAFE_INT_TAG]: true, digits: raw };
      }
    }
    return Number(raw);
  }

  const result = parseValue();
  skipWs();
  if (i !== n) fail("trailing content after JSON value");
  return result;
}

// ---------------------------------------------------------------------
// Money — BigInt minor-unit wire contract. Only string decimal input is
// ever accepted; a raw JS `number` for a money field is always
// FAIL_IN_SCOPE (that is precisely the "uncontrolled floating-point
// semantics" this rule exists to close).
// ---------------------------------------------------------------------

export function moneyStringToMinorUnits(decimal: string, scale = 2): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!m) throw new JsonTextParseError(`not a fixed-point decimal string: ${decimal}`);
  const [, sign, intPart, fracPartRaw = ""] = m;
  if (fracPartRaw.length > scale) throw new JsonTextParseError(`decimal has more than ${scale} fractional digits: ${decimal}`);
  const fracPart = fracPartRaw.padEnd(scale, "0");
  const minor = BigInt(intPart + fracPart);
  return sign === "-" ? -minor : minor;
}

export function minorUnitsToMoneyString(minor: bigint, scale = 2): string {
  const negative = minor < BigInt(0);
  const abs = negative ? -minor : minor;
  const s = abs.toString().padStart(scale + 1, "0");
  const intPart = s.slice(0, s.length - scale);
  const fracPart = s.slice(s.length - scale);
  return `${negative ? "-" : ""}${intPart}${scale > 0 ? "." + fracPart : ""}`;
}

// ---------------------------------------------------------------------
// Undeclared-exotic scan — applied to any subtree reached via an
// "unknown" contract node, and always applied to the whole encode-side
// value tree regardless of contract, since Map/Set/BigInt/Date/
// undefined-in-array corruption must never pass silently even in
// declared regions the contract didn't fully cover.
// ---------------------------------------------------------------------

function scanForUndeclaredExotics(
  value: unknown,
  path: string,
  boundary: BoundaryId,
  correlationId: string | null,
  out: BoundaryEvidenceEntry[],
  insideArray: boolean
): void {
  if (value === undefined) {
    if (insideArray) {
      out.push({
        boundary,
        path,
        expectedType: "contracted value",
        receivedType: "undefined (would silently become null in array)",
        reason: "undefined inside an array is forbidden unless explicitly contracted",
        correlationId,
      });
    }
    return;
  }
  if (typeof value === "bigint") {
    out.push({
      boundary,
      path,
      expectedType: "contracted bigint encoding",
      receivedType: "bigint",
      reason: "BigInt cannot cross vanilla JSON serialization without explicit encoding",
      correlationId,
    });
    return;
  }
  if (value instanceof Date) {
    out.push({
      boundary,
      path,
      expectedType: "contracted date encoding",
      receivedType: "Date instance",
      reason: "Date object has no explicit declared representation at this path; silent toJSON()/toISOString() conversion is forbidden",
      correlationId,
    });
    return;
  }
  if (value instanceof Map) {
    out.push({
      boundary,
      path,
      expectedType: "contracted map encoding",
      receivedType: "Map instance",
      reason: "Map would silently serialize to {} via vanilla JSON.stringify",
      correlationId,
    });
    return;
  }
  if (value instanceof Set) {
    out.push({
      boundary,
      path,
      expectedType: "contracted set encoding",
      receivedType: "Set instance",
      reason: "Set would silently serialize to {} via vanilla JSON.stringify",
      correlationId,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => scanForUndeclaredExotics(item, `${path}[${idx}]`, boundary, correlationId, out, true));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      scanForUndeclaredExotics(v, `${path}.${k}`, boundary, correlationId, out, false);
    }
  }
}

// ---------------------------------------------------------------------
// Decode: raw boundary value (already-precision-preserving-parsed) ->
// validated in-memory value, per contract.
// ---------------------------------------------------------------------

function decodeValue(
  contract: FieldContract,
  raw: unknown,
  path: string,
  fieldPresent: boolean,
  boundary: BoundaryId,
  correlationId: string | null,
  out: BoundaryEvidenceEntry[]
): unknown {
  switch (contract.kind) {
    case "longId": {
      if (isUnsafeIntSentinel(raw)) return raw.digits;
      if (typeof raw === "string" && /^-?\d+$/.test(raw)) return raw;
      out.push({
        boundary,
        path,
        expectedType: "LONG_ID (digit string)",
        receivedType: raw === null ? "null" : typeof raw,
        reason: "long identifier must be a digit string; unsafe integers must never exist as a JS number",
        correlationId,
      });
      return undefined;
    }
    case "money": {
      if (typeof raw !== "string") {
        out.push({
          boundary,
          path,
          expectedType: "MONEY (fixed-point decimal string)",
          receivedType: isUnsafeIntSentinel(raw) ? "unsafe integer literal" : typeof raw,
          reason: "money must never be represented as a JS floating-point number; only a fixed-point decimal string is accepted",
          correlationId,
        });
        return undefined;
      }
      try {
        moneyStringToMinorUnits(raw, contract.scale ?? 2);
      } catch (e) {
        out.push({
          boundary,
          path,
          expectedType: `MONEY (fixed-point decimal string, scale=${contract.scale ?? 2})`,
          receivedType: "string",
          reason: `money string failed exact decimal parse: ${(e as Error).message}`,
          correlationId,
        });
        return undefined;
      }
      return raw;
    }
    case "date": {
      if (typeof raw !== "string") {
        out.push({
          boundary,
          path,
          expectedType: `DATE (${contract.encoding})`,
          receivedType: raw instanceof Date ? "Date instance" : typeof raw,
          reason: "date value must arrive as an explicitly-encoded string, never a Date instance or bare number",
          correlationId,
        });
        return undefined;
      }
      if (contract.encoding === "ISO8601_STRING") {
        const t = Date.parse(raw);
        if (Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
          out.push({
            boundary,
            path,
            expectedType: "DATE (ISO8601_STRING)",
            receivedType: "string",
            reason: `value is not a strict ISO-8601 timestamp: ${raw}`,
            correlationId,
          });
          return undefined;
        }
      } else {
        if (!/^-?\d+$/.test(raw)) {
          out.push({
            boundary,
            path,
            expectedType: `DATE (${contract.encoding})`,
            receivedType: "string",
            reason: `value is not a numeric epoch string for encoding ${contract.encoding}: ${raw}`,
            correlationId,
          });
          return undefined;
        }
      }
      return raw;
    }
    case "patch": {
      if (!fieldPresent) {
        out.push({
          boundary,
          path,
          expectedType: "PATCH (UNCHANGED | SET | CLEAR tag, explicit)",
          receivedType: "missing field",
          reason: "PATCH semantics must never be inferred from a missing JSON field",
          correlationId,
        });
        return undefined;
      }
      if (typeof raw !== "object" || raw === null || Array.isArray(raw) || typeof (raw as Record<string, unknown>).tag !== "string") {
        out.push({
          boundary,
          path,
          expectedType: "PATCH (UNCHANGED | SET | CLEAR tag, explicit)",
          receivedType: raw === undefined ? "undefined" : typeof raw,
          reason: "PATCH value must be an explicit tagged object, never a bare value or undefined",
          correlationId,
        });
        return undefined;
      }
      const tag = (raw as Record<string, unknown>).tag;
      if (tag === "UNCHANGED") return { tag: "UNCHANGED" } as PatchState<unknown>;
      if (tag === "CLEAR") return { tag: "CLEAR" } as PatchState<unknown>;
      if (tag === "SET") {
        const inner = decodeValue(contract.of, (raw as Record<string, unknown>).value, `${path}.value`, true, boundary, correlationId, out);
        return { tag: "SET", value: inner } as PatchState<unknown>;
      }
      out.push({
        boundary,
        path,
        expectedType: "PATCH tag in {UNCHANGED, SET, CLEAR}",
        receivedType: `tag="${String(tag)}"`,
        reason: "unrecognized PATCH tag",
        correlationId,
      });
      return undefined;
    }
    case "map": {
      if (
        typeof raw !== "object" || raw === null || Array.isArray(raw) ||
        (raw as Record<string, unknown>).__type !== "Map" || !Array.isArray((raw as Record<string, unknown>).entries)
      ) {
        out.push({
          boundary,
          path,
          expectedType: 'MAP (tagged {"__type":"Map","entries":[[k,v],...]})',
          receivedType: typeof raw,
          reason: "Map must be explicitly tag-encoded; plain objects/arrays are not accepted as Map wire form",
          correlationId,
        });
        return undefined;
      }
      const entries = (raw as { entries: unknown[] }).entries;
      const decoded = new Map<unknown, unknown>();
      entries.forEach((entry, idx) => {
        if (!Array.isArray(entry) || entry.length !== 2) {
          out.push({
            boundary,
            path: `${path}.entries[${idx}]`,
            expectedType: "[key, value] tuple",
            receivedType: typeof entry,
            reason: "Map entry must be a 2-tuple",
            correlationId,
          });
          return;
        }
        const v = decodeValue(contract.of, entry[1], `${path}.entries[${idx}][1]`, true, boundary, correlationId, out);
        decoded.set(entry[0], v);
      });
      return decoded;
    }
    case "set": {
      if (
        typeof raw !== "object" || raw === null || Array.isArray(raw) ||
        (raw as Record<string, unknown>).__type !== "Set" || !Array.isArray((raw as Record<string, unknown>).values)
      ) {
        out.push({
          boundary,
          path,
          expectedType: 'SET (tagged {"__type":"Set","values":[...]})',
          receivedType: typeof raw,
          reason: "Set must be explicitly tag-encoded; plain arrays are not accepted as Set wire form",
          correlationId,
        });
        return undefined;
      }
      const values = (raw as { values: unknown[] }).values;
      const decoded = new Set<unknown>();
      values.forEach((v, idx) => decoded.add(decodeValue(contract.of, v, `${path}.values[${idx}]`, true, boundary, correlationId, out)));
      return decoded;
    }
    case "bigint": {
      if (
        typeof raw !== "object" || raw === null ||
        (raw as Record<string, unknown>).__type !== "BigInt" || typeof (raw as Record<string, unknown>).value !== "string"
      ) {
        out.push({
          boundary,
          path,
          expectedType: 'BIGINT (tagged {"__type":"BigInt","value":"<digits>"})',
          receivedType: typeof raw,
          reason: "BigInt must be explicitly tag-encoded as a digit string; it cannot cross vanilla JSON",
          correlationId,
        });
        return undefined;
      }
      try {
        return BigInt((raw as { value: string }).value);
      } catch {
        out.push({
          boundary,
          path,
          expectedType: "BIGINT digit string",
          receivedType: "string",
          reason: "BigInt-tagged value string is not a valid integer literal",
          correlationId,
        });
        return undefined;
      }
    }
    case "string": {
      if (typeof raw !== "string") {
        out.push({ boundary, path, expectedType: "string", receivedType: isUnsafeIntSentinel(raw) ? "unsafe integer literal" : typeof raw, reason: "expected string", correlationId });
        return undefined;
      }
      return raw;
    }
    case "number": {
      if (isUnsafeIntSentinel(raw)) {
        out.push({
          boundary,
          path,
          expectedType: "number (safe range)",
          receivedType: "unsafe integer literal",
          reason: `integer literal ${raw.digits} exceeds Number.MAX_SAFE_INTEGER and would lose precision as a JS number`,
          correlationId,
        });
        return undefined;
      }
      if (typeof raw !== "number" || Number.isNaN(raw)) {
        out.push({ boundary, path, expectedType: "number", receivedType: typeof raw, reason: "expected number", correlationId });
        return undefined;
      }
      return raw;
    }
    case "boolean": {
      if (typeof raw !== "boolean") {
        out.push({ boundary, path, expectedType: "boolean", receivedType: typeof raw, reason: "expected boolean", correlationId });
        return undefined;
      }
      return raw;
    }
    case "literal": {
      if (raw !== contract.value) {
        out.push({ boundary, path, expectedType: `literal "${contract.value}"`, receivedType: typeof raw, reason: "literal mismatch", correlationId });
        return undefined;
      }
      return raw;
    }
    case "nullable": {
      if (raw === null) return null;
      return decodeValue(contract.of, raw, path, fieldPresent, boundary, correlationId, out);
    }
    case "array": {
      if (!Array.isArray(raw)) {
        out.push({ boundary, path, expectedType: "array", receivedType: typeof raw, reason: "expected array", correlationId });
        return undefined;
      }
      return raw.map((item, idx) => decodeValue(contract.of, item, `${path}[${idx}]`, true, boundary, correlationId, out));
    }
    case "object": {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        out.push({ boundary, path, expectedType: "object", receivedType: raw === null ? "null" : typeof raw, reason: "expected object", correlationId });
        return undefined;
      }
      const src = raw as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of contract.required) {
        if (!(key in src)) {
          out.push({
            boundary,
            path: `${path}.${key}`,
            expectedType: contract.fields[key]?.kind ?? "required field",
            receivedType: "missing",
            reason: "required field disappeared after serialization round trip",
            correlationId,
          });
        }
      }
      for (const [key, subContract] of Object.entries(contract.fields)) {
        const present = key in src;
        result[key] = decodeValue(subContract, src[key], `${path}.${key}`, present, boundary, correlationId, out);
      }
      return result;
    }
    case "unknown": {
      scanForUndeclaredExotics(raw, path, boundary, correlationId, out, false);
      return raw;
    }
  }
}

// ---------------------------------------------------------------------
// Encode: in-memory value -> JSON-serializable wire value, per contract.
// Applied before persistence/transport (API_OUTPUT, WORKER_REQUEST,
// QUEUE/ARTIFACT/EVIDENCE, DOCUMENT_FINANCE_WRITE encode direction).
// ---------------------------------------------------------------------

function encodeValue(
  contract: FieldContract,
  value: unknown,
  path: string,
  boundary: BoundaryId,
  correlationId: string | null,
  out: BoundaryEvidenceEntry[]
): unknown {
  switch (contract.kind) {
    case "longId": {
      if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
        out.push({
          boundary,
          path,
          expectedType: "LONG_ID (digit string)",
          receivedType: typeof value,
          reason: "long identifier must already be held as a digit string at encode time; a JS number here means precision was already lost upstream",
          correlationId,
        });
        return null;
      }
      return value;
    }
    case "money": {
      if (typeof value !== "string") {
        out.push({
          boundary,
          path,
          expectedType: "MONEY (fixed-point decimal string)",
          receivedType: typeof value,
          reason: "money must be held as a fixed-point decimal string; JS number would carry uncontrolled floating-point semantics",
          correlationId,
        });
        return null;
      }
      try {
        moneyStringToMinorUnits(value, contract.scale ?? 2);
      } catch (e) {
        out.push({ boundary, path, expectedType: "MONEY (fixed-point decimal string)", receivedType: "string", reason: `invalid money string: ${(e as Error).message}`, correlationId });
        return null;
      }
      return value;
    }
    case "date": {
      if (value instanceof Date) {
        return contract.encoding === "ISO8601_STRING" ? value.toISOString() : String(value.getTime());
      }
      if (typeof value === "string") return value;
      out.push({ boundary, path, expectedType: `DATE (${contract.encoding})`, receivedType: typeof value, reason: "date value must be a Date instance or already-encoded string", correlationId });
      return null;
    }
    case "patch": {
      const p = value as PatchState<unknown> | undefined;
      if (!p || typeof p !== "object" || typeof (p as { tag?: unknown }).tag !== "string") {
        out.push({ boundary, path, expectedType: "PATCH (UNCHANGED | SET | CLEAR)", receivedType: typeof value, reason: "PATCH value must be an explicit tagged state, never undefined", correlationId });
        return null;
      }
      if (p.tag === "UNCHANGED") return { tag: "UNCHANGED" };
      if (p.tag === "CLEAR") return { tag: "CLEAR" };
      if (p.tag === "SET") return { tag: "SET", value: encodeValue(contract.of, (p as { value: unknown }).value, `${path}.value`, boundary, correlationId, out) };
      out.push({ boundary, path, expectedType: "PATCH tag in {UNCHANGED,SET,CLEAR}", receivedType: `tag="${String((p as { tag: unknown }).tag)}"`, reason: "unrecognized PATCH tag", correlationId });
      return null;
    }
    case "map": {
      if (!(value instanceof Map)) {
        out.push({ boundary, path, expectedType: "Map instance", receivedType: typeof value, reason: "expected a real Map to encode", correlationId });
        return null;
      }
      return { __type: "Map", entries: Array.from(value.entries()).map(([k, v], idx) => [k, encodeValue(contract.of, v, `${path}.entries[${idx}]`, boundary, correlationId, out)]) };
    }
    case "set": {
      if (!(value instanceof Set)) {
        out.push({ boundary, path, expectedType: "Set instance", receivedType: typeof value, reason: "expected a real Set to encode", correlationId });
        return null;
      }
      return { __type: "Set", values: Array.from(value.values()).map((v, idx) => encodeValue(contract.of, v, `${path}.values[${idx}]`, boundary, correlationId, out)) };
    }
    case "bigint": {
      if (typeof value !== "bigint") {
        out.push({ boundary, path, expectedType: "bigint", receivedType: typeof value, reason: "expected a real bigint to encode", correlationId });
        return null;
      }
      return { __type: "BigInt", value: value.toString() };
    }
    case "string":
      if (typeof value !== "string") { out.push({ boundary, path, expectedType: "string", receivedType: typeof value, reason: "expected string", correlationId }); return null; }
      return value;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) { out.push({ boundary, path, expectedType: "number", receivedType: typeof value, reason: "expected number", correlationId }); return null; }
      if (!Number.isSafeInteger(value) && Number.isInteger(value)) {
        out.push({ boundary, path, expectedType: "number (safe range)", receivedType: "number", reason: "integer exceeds Number.MAX_SAFE_INTEGER; must be declared LONG_ID instead", correlationId });
        return null;
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") { out.push({ boundary, path, expectedType: "boolean", receivedType: typeof value, reason: "expected boolean", correlationId }); return null; }
      return value;
    case "literal":
      return contract.value;
    case "nullable":
      if (value === null) return null;
      return encodeValue(contract.of, value, path, boundary, correlationId, out);
    case "array": {
      if (!Array.isArray(value)) { out.push({ boundary, path, expectedType: "array", receivedType: typeof value, reason: "expected array", correlationId }); return null; }
      return value.map((item, idx) => {
        if (item === undefined) {
          out.push({ boundary, path: `${path}[${idx}]`, expectedType: contract.of.kind, receivedType: "undefined", reason: "undefined in array would silently become null via JSON.stringify", correlationId });
          return null;
        }
        return encodeValue(contract.of, item, `${path}[${idx}]`, boundary, correlationId, out);
      });
    }
    case "object": {
      if (typeof value !== "object" || value === null) { out.push({ boundary, path, expectedType: "object", receivedType: typeof value, reason: "expected object", correlationId }); return null; }
      const src = value as Record<string, unknown>;
      for (const key of contract.required) {
        if (!(key in src) || src[key] === undefined) {
          out.push({ boundary, path: `${path}.${key}`, expectedType: contract.fields[key]?.kind ?? "required field", receivedType: "missing", reason: "required field missing before encode; would disappear after serialization round trip", correlationId });
        }
      }
      const result: Record<string, unknown> = {};
      for (const [key, subContract] of Object.entries(contract.fields)) {
        result[key] = encodeValue(subContract, src[key], `${path}.${key}`, boundary, correlationId, out);
      }
      return result;
    }
    case "unknown": {
      scanForUndeclaredExotics(value, path, boundary, correlationId, out, false);
      return value;
    }
  }
}

// ---------------------------------------------------------------------
// Public gate API
// ---------------------------------------------------------------------

export interface GateOptions {
  correlationId?: string | null;
}

function verdictFor(evidence: BoundaryEvidenceEntry[]): BoundaryVerdict {
  return evidence.length === 0 ? "PASS_IN_SCOPE" : "FAIL_IN_SCOPE";
}

/**
 * Decode raw external JSON TEXT (never a pre-parsed object — see the
 * precision-preserving-parse note above) into a contract-validated
 * in-memory value. Fails closed: throws on any violation.
 */
export function decodeAtBoundary<T>(boundary: BoundaryId, contract: FieldContract, rawJsonText: string, opts: GateOptions = {}): T {
  const correlationId = opts.correlationId ?? null;
  let parsed: unknown;
  try {
    parsed = parseJsonPreservingPrecision(rawJsonText);
  } catch (e) {
    throw new DataIntegrityBoundaryFailure([
      { boundary, path: "$", expectedType: "valid JSON", receivedType: "unparseable text", reason: `JSON parse failed: ${(e as Error).message}`, correlationId },
    ]);
  }
  const evidence: BoundaryEvidenceEntry[] = [];
  const value = decodeValue(contract, parsed, "$", true, boundary, correlationId, evidence);
  if (evidence.length > 0) throw new DataIntegrityBoundaryFailure(evidence);
  return value as T;
}

/**
 * Decode an ALREADY-PARSED value (only safe to use when the caller
 * guarantees no unsafe integer literal could appear — e.g. a value this
 * runtime itself produced, or a value that already passed
 * decodeAtBoundary once). Prefer decodeAtBoundary for anything that
 * touched external JSON text.
 */
export function decodeParsedAtBoundary<T>(boundary: BoundaryId, contract: FieldContract, parsed: unknown, opts: GateOptions = {}): T {
  const correlationId = opts.correlationId ?? null;
  const evidence: BoundaryEvidenceEntry[] = [];
  const value = decodeValue(contract, parsed, "$", true, boundary, correlationId, evidence);
  if (evidence.length > 0) throw new DataIntegrityBoundaryFailure(evidence);
  return value as T;
}

/** Encode an in-memory value into a JSON-safe wire value + serialize it. Fails closed. */
export function encodeAtBoundary(boundary: BoundaryId, contract: FieldContract, value: unknown, opts: GateOptions = {}): string {
  const correlationId = opts.correlationId ?? null;
  const evidence: BoundaryEvidenceEntry[] = [];
  const wire = encodeValue(contract, value, "$", boundary, correlationId, evidence);
  if (evidence.length > 0) throw new DataIntegrityBoundaryFailure(evidence);
  return JSON.stringify(wire);
}

/** Same as encodeAtBoundary but returns the wire-safe object instead of a JSON string (for callers that serialize themselves, e.g. artifact checksum construction). */
export function encodeValueAtBoundary(boundary: BoundaryId, contract: FieldContract, value: unknown, opts: GateOptions = {}): unknown {
  const correlationId = opts.correlationId ?? null;
  const evidence: BoundaryEvidenceEntry[] = [];
  const wire = encodeValue(contract, value, "$", boundary, correlationId, evidence);
  if (evidence.length > 0) throw new DataIntegrityBoundaryFailure(evidence);
  return wire;
}

/** Non-throwing variant — returns a BoundaryOutcome instead of throwing, for callers (e.g. Runtime Patrol) that need to report INSUFFICIENT_EVIDENCE/OUT_OF_SCOPE distinctly rather than treat every non-pass as an exception. */
export function checkAtBoundary<T>(boundary: BoundaryId, contract: FieldContract, rawJsonText: string, opts: GateOptions = {}): BoundaryOutcome<T> {
  const correlationId = opts.correlationId ?? null;
  let parsed: unknown;
  try {
    parsed = parseJsonPreservingPrecision(rawJsonText);
  } catch (e) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      value: null,
      evidence: [{ boundary, path: "$", expectedType: "valid JSON", receivedType: "unparseable text", reason: `JSON parse failed: ${(e as Error).message}`, correlationId }],
    };
  }
  const evidence: BoundaryEvidenceEntry[] = [];
  const value = decodeValue(contract, parsed, "$", true, boundary, correlationId, evidence);
  return { verdict: verdictFor(evidence), value: evidence.length === 0 ? (value as T) : null, evidence };
}
