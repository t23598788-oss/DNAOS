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
 * Same comment stripping the repo already uses in its gate scripts.
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
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

module.exports = {
  CANONICAL_WRITER_DIR,
  stripComments,
  findMutationSitesInSource,
  findDirectMutations,
  describeSites,
};
