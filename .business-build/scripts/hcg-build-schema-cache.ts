#!/usr/bin/env npx tsx
/**
 * Builds registry/hardcode-governance/schema-identifier-cache.json — the real
 * evidence source for the SCHEMA_IDENTIFIER classification (HCG Phase 2.7).
 * No registry in this repo enumerates real table/column names (checked:
 * registry/schemas.json is TS-shape schemas, not DB tables; registry/database/
 * *.registry.json are domain descriptions with no column lists) — the actual
 * source of truth is the migration SQL itself. Parses `CREATE TABLE ... (...)`
 * blocks from supabase/migrations/*.sql for real table + column names.
 * Heuristic parser (regex-based, not a real SQL parser) — good enough for a
 * conservative allowlist (false negatives just mean more UNKNOWN, which is
 * safe; a false positive here would wrongly ALLOW a value, so column-name
 * extraction is intentionally strict: only simple `column_name TYPE` lines).
 *
 * Re-run this after schema changes: npx tsx scripts/hcg-build-schema-cache.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const OUT = join(__dirname, "..", "registry", "hardcode-governance", "schema-identifier-cache.json");

const tables = new Set<string>();
const columns = new Set<string>();

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
for (const f of files) {
  const text = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
  const tableRe = /create\s+table\s+(if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(text))) {
    tables.add(m[2]);
    // Find the matching closing paren block (naive: up to the next ');' at column 0 of a statement)
    const start = m.index + m[0].length;
    const end = text.indexOf(");", start);
    if (end === -1) continue;
    const body = text.slice(start, end);
    for (const line of body.split(",")) {
      const colMatch = line.trim().match(/^([a-z_][a-z0-9_]*)\s+(uuid|text|integer|bigint|boolean|timestamptz|timestamp|numeric|jsonb|json|date|varchar|character|smallint|real|double)/i);
      if (colMatch) columns.add(colMatch[1]);
    }
  }
  const alterColRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?[a-z_][a-z0-9_]*\s+add\s+column\s+(if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+/gi;
  while ((m = alterColRe.exec(text))) {
    columns.add(m[2]);
  }
}

const out = {
  version: 1,
  generated_at: new Date().toISOString(),
  source: "supabase/migrations/*.sql (regex-based CREATE TABLE / ALTER TABLE ADD COLUMN extraction, not a real SQL parser)",
  note: "Evidence source for SCHEMA_IDENTIFIER classification (HCG Phase 2.7). A literal value is only classified SCHEMA_IDENTIFIER if it appears verbatim in this cache — never guessed from shape alone.",
  files_scanned: files.length,
  tables: Array.from(tables).sort(),
  columns: Array.from(columns).sort(),
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf-8");
console.log(`Scanned ${files.length} migration files. Found ${tables.size} tables, ${columns.size} columns.`);
