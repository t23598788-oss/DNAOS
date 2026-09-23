/**
 * Direct-DB mutation census (BLOCK-1, owner 2026-09-23).
 *
 * INSPECTION / TEST INFRASTRUCTURE ONLY — this module is not a runtime
 * authority: it never touches a database, never writes, and is loaded by test
 * suites only (scripts/business-event-authority-test.ts today; the remaining
 * domain censuses next). One shared, provable detector instead of a per-test
 * regex, so a fix lands everywhere at once.
 *
 * Why it exists — the real defect it closes: the previous business_events
 * detector matched DOUBLE-QUOTED table names only,
 *   /\.from\("business_events"\)[\s\S]{0,240}?\.(insert|upsert|update|delete)\s*\(/
 * while this repo's Deno code writes with SINGLE quotes. A real direct writer
 * (supabase/functions/debt-reminder-cron/index.ts:241) therefore passed the
 * census, and Capability D was reported complete while an authority violation
 * was still live. A quote-style blind spot is systematic (Deno vs Node style),
 * not a one-off, so the detector now covers both.
 *
 * File format note: deliberately `.cjs` in scripts/lib/ — the same choice as the
 * existing scripts/lib/registry-query.cjs. sync-registry registers TypeScript
 * sources only (the ts/tsx glob), and check-registry audits only app components
 * core engines gateway cognitive presenter services plugins, so a test-only
 * helper here needs no module-registry entry and adds no registry churn. It is
 * not app source.
 *
 * Detection rules (deliberately conservative — a report-only hit is impossible):
 *   1. quote styles: '  "  `   (Deno and Node both covered)
 *   2. chain-scoped: the write op must sit inside the SAME call chain as
 *      `.from(` — scanning stops at the next `.from(` or at the statement's
 *      `;`, so a following statement's write can never be mis-attributed
 *   3. ops: insert / update / upsert / delete (plus rpc, which callers treat as
 *      a distinct signal rather than a table mutation)
 *   4. comments are stripped first, so a documented example is never a hit
 *      (e.g. scripts/build-arch-book.ts's own detector regex contains the text
 *      `.from("business_events").insert(` inside a comment)
 */

const { readFileSync, readdirSync } = require("fs");
const { join } = require("path");

/**
 * @typedef {"insert" | "update" | "upsert" | "delete" | "rpc"} MutationOp
 * @typedef {{ file: string, line: number, op: MutationOp }} MutationSite
 */

/** Every canonical writer lives here; callers use this to split authority vs not. */
const CANONICAL_WRITER_DIR = "engines/canonical/";

const FROM_RE = /\.from\(\s*['"`]([a-zA-Z_0-9]+)['"`]\s*\)/g;
const OP_RE = /\.(insert|update|upsert|delete|rpc)\s*\(/g;

/**
 * JS built-ins whose `.from(...)` is NOT a database query builder. Without this,
 * `createHash("sha256").update(Buffer.from(bytes))` reads as a table write — a
 * real false positive found live while building BLOCK-2. Bounded, explicit list.
 */
const NON_DB_RECEIVERS = [
  "Buffer", "Array", "Object", "String", "Number", "BigInt", "Boolean",
  "Math", "JSON", "Date", "Promise", "Reflect", "Symbol", "Uint8Array",
];

/** The identifier immediately before `index` in `line` (the `.from(` receiver). */
function receiverBefore(line, index) {
  const before = line.slice(0, index);
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
  return m ? m[1] : "";
}

/** True when this `.from(` belongs to a non-database JS builtin. */
function isNonDbFrom(line, index) {
  return NON_DB_RECEIVERS.indexOf(receiverBefore(line, index)) >= 0;
}


/**
 * Comment stripping that PRESERVES line structure (same as the repo's gate
 * scripts, plus the line-count fix): a removed block comment leaves its
 * newlines in place, so every reported line number matches the real source
 * line. Without this, positions shift by one per removed comment line and a
 * finding's location cannot be trusted.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, " "); })
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Sites in ONE source text. Exported so a suite can prove the detector itself
 * (positive control) instead of trusting it.
 * @param {string} code
 * @param {string} file
 * @param {string} table
 * @returns {MutationSite[]}
 */
function findMutationSitesInSource(code, file, table) {
  const lines = stripComments(code).split("\n");
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    FROM_RE.lastIndex = 0;
    const m = FROM_RE.exec(lines[i]);
    if (!m || m[1] !== table) continue;
    if (isNonDbFrom(lines[i], m.index)) continue; // e.g. Buffer.from(...) — not a table

    const chain = [lines[i]];
    for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
      FROM_RE.lastIndex = 0;
      if (FROM_RE.exec(lines[j])) break; // a new chain starts -> stop
      chain.push(lines[j]);
      if (lines[j].includes(";")) break; // statement ended -> stop
    }

    OP_RE.lastIndex = 0;
    const op = OP_RE.exec(chain.join("\n"));
    if (op) sites.push({ file, line: i + 1, op: op[1] });
  }
  return sites;
}

/**
 * Repository-wide census for one table, across every runtime that can write it.
 * @param {{ root: string, table: string, dirs: readonly string[] }} options
 * @returns {MutationSite[]}
 */
function findDirectMutations(options) {
  const { root, table, dirs } = options;
  const sites = [];

  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return; // a missing optional dir is not a finding
    }
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(child);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      sites.push(...findMutationSitesInSource(readFileSync(join(root, child), "utf-8"), child, table));
    }
  };

  for (const dir of dirs) walk(dir);
  return sites;
}

/**
 * `file:line:op, file:line:op` — the shape every gate message should use.
 * @param {readonly MutationSite[]} sites
 * @returns {string}
 */
function describeSites(sites) {
  return sites.map((s) => `${s.file}:${s.line}:${s.op}`).join(", ");
}

/**
 * STRICT dynamic-table resolution (BLOCK-2, D1 — owner approved 2026-09-23).
 *
 * `engines/canonical/document-write.ts` writes invoices / standalone_documents
 * through a variable: `const table = input.kind === "invoice" ? "invoices" :
 * "standalone_documents"` then `.from(table)`. The literal census cannot see
 * that, so it reported "0 canonical writers" for those tables — a false
 * negative. Reporting them as unowned is wrong; blanket-exempting the file would
 * be an exclusion. So instead we RESOLVE it, strictly:
 *
 * A `.from(<var>)` write site counts as canonical authority ONLY when ALL of:
 *   1. the file is inside CANONICAL_WRITER_DIR (engines/canonical/)
 *   2. `<var>` has a local declaration in the SAME file
 *   3. its initializer is a simple ternary `<cond> ? <lit> : <lit>` whose two
 *      VALUE positions are plain string literals (no template holes, no calls)
 *   4. every value literal is inside the allow-list the caller declares
 * Everything else is NOT counted as authority:
 *   - no local declaration / not a simple ternary / a call or template in the
 *     initializer           -> `unresolved` (no provable finite literal set)
 *   - a literal outside the allow-list -> `violations` (must FAIL the gate)
 *   - resolvable + allow-listed, but the file is NOT in the canonical dir
 *     -> `outside` (a real authority violation, reported as such)
 *
 * Conditions are deliberately unconstrained: a condition can only SELECT among
 * the literals present; it can never produce a new table name.
 */

/** Split an expression on the given single-char separators, ignoring nesting. */
function splitTopLevel(expr, seps) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (depth === 0 && seps.indexOf(ch) >= 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** A plain quoted string (single, double or backtick WITHOUT interpolation). */
function literalValue(token) {
  const t = token.trim();
  const simple = /^(['"])([\s\S]*)\1$/.exec(t);
  if (simple) return { ok: true, value: simple[2] };
  if (t.length > 1 && t[0] === "`" && t[t.length - 1] === "`") {
    if (t.indexOf("${") >= 0) return { ok: false, reason: "TEMPLATE_INTERPOLATION" };
    return { ok: true, value: t.slice(1, -1) };
  }
  return { ok: false, reason: "VALUE_POSITION_NOT_A_LITERAL" };
}

/**
 * Strict finite-literal-set resolution of a table-selector initializer.
 * @param {string} expr
 * @returns {{ ok: true, values: string[] } | { ok: false, reason: string }}
 */
function resolveFiniteLiteralSet(expr) {
  const raw = String(expr).trim();
  if (/[A-Za-z_$][\w$]*\s*\(/.test(raw)) return { ok: false, reason: "CALL_IN_EXPRESSION" };
  if (raw.indexOf("${") >= 0) return { ok: false, reason: "TEMPLATE_INTERPOLATION" };
  const q = splitTopLevel(raw, "?");
  if (q.length !== 2) return { ok: false, reason: "NOT_A_SIMPLE_TERNARY" };
  const c = splitTopLevel(q[1], ":");
  if (c.length !== 2) return { ok: false, reason: "NOT_A_SIMPLE_TERNARY" };
  const values = [c[0], c[1]].map(literalValue);
  if (!values.every((v) => v.ok)) return { ok: false, reason: values.find((v) => !v.ok).reason };
  return { ok: true, values: values.map((v) => v.value) };
}

/**
 * Dynamic-table write sites in ONE source text.
 * @param {string} code
 * @param {string} file
 * @param {readonly string[]} allowList
 * @returns {{ sites: MutationSite[], outside: object[], violations: object[], unresolved: object[] }}
 */
function findDynamicTableMutationsInSource(code, file, allowList) {
  const isCanonicalFile = file.indexOf(CANONICAL_WRITER_DIR) === 0;
  const lines = stripComments(code).split("\n");
  const src = lines.join("\n");

  const decls = new Map();
  const declRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let dm;
  while ((dm = declRe.exec(src))) decls.set(dm[1], dm[2]);

  const sites = [];
  const outside = [];
  const violations = [];
  const unresolved = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/\.from\(/.test(lines[i])) continue;
    // the argument may wrap onto the next line, so match across a small window
    const win = [lines[i], lines[i + 1] || "", lines[i + 2] || ""].join("\n");
    const fm = /\.from\(\s*([^)]*?)\s*\)/.exec(win);
    if (!fm) continue;
    if (isNonDbFrom(win, fm.index)) continue; // e.g. Buffer.from(...) — not a table
    const argRaw = fm[1].trim();
    if (/^['"`]/.test(argRaw)) continue; // a quoted literal is the other census's job

    const chain = [lines[i]];
    for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
      if (/\.from\(/.test(lines[j])) break;
      chain.push(lines[j]);
      if (lines[j].includes(";")) break;
    }
    OP_RE.lastIndex = 0;
    const op = OP_RE.exec(chain.join("\n"));
    if (!op) continue; // read-only chain

    const base = { file, line: i + 1, op: op[1] };
    const bare = /^[A-Za-z_$][\w$]*$/.exec(argRaw);
    if (!bare) {
      // e.g. `.from(someInput.table)` / `.from(getTable())` — NOT provable, and
      // deliberately NOT silently ignored (that was a real blind spot: neither
      // this resolver nor the literal census used to see it at all).
      unresolved.push(Object.assign({ variable: argRaw, reason: "EXTERNAL_TABLE_EXPRESSION" }, base));
      continue;
    }
    const variable = bare[0];
    const expr = decls.get(variable);
    const resolved = expr === undefined
      ? { ok: false, reason: "NO_LOCAL_DECLARATION" }
      : resolveFiniteLiteralSet(expr);

    if (!resolved.ok) {
      unresolved.push(Object.assign({ variable, reason: resolved.reason }, base));
      continue;
    }
    const notAllowed = resolved.values.filter((v) => allowList.indexOf(v) < 0);
    if (notAllowed.length) {
      violations.push(Object.assign({ variable, literals: resolved.values, notAllowed, reason: "LITERAL_OUTSIDE_ALLOW_LIST" }, base));
      continue;
    }
    if (!isCanonicalFile) {
      outside.push(Object.assign({ variable, tables: resolved.values }, base));
      continue;
    }
    for (const t of resolved.values) sites.push({ file, line: i + 1, op: op[1], table: t });
  }

  return { sites, outside, violations, unresolved };
}

/**
 * Repository-wide dynamic-table census.
 * @param {{ root: string, dirs: readonly string[], allowList: readonly string[] }} options
 */
function findDynamicTableMutations(options) {
  const { root, dirs, allowList } = options;
  const acc = { sites: [], outside: [], violations: [], unresolved: [] };
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(child);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      const r = findDynamicTableMutationsInSource(readFileSync(join(root, child), "utf-8"), child, allowList);
      acc.sites.push(...r.sites);
      acc.outside.push(...r.outside);
      acc.violations.push(...r.violations);
      acc.unresolved.push(...r.unresolved);
    }
  };
  for (const dir of dirs) walk(dir);
  return acc;
}

module.exports = {
  CANONICAL_WRITER_DIR,
  stripComments,
  findMutationSitesInSource,
  findDirectMutations,
  describeSites,
  resolveFiniteLiteralSet,
  findDynamicTableMutationsInSource,
  findDynamicTableMutations,
};


