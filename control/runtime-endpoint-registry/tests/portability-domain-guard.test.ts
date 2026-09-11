/**
 * Fail if canonical runtime-decision TypeScript contains provider listen domains.
 * Scans only Core/runtime trees. Adapters/IAC/email evidence are not scanned.
 *
 * Run: npx tsx control/runtime-endpoint-registry/tests/portability-domain-guard.test.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const ROOT = process.cwd();
const DOMAIN = /\.(railway|vercel)\.app\b/i;
const SKIP_DIR = new Set([
  "node_modules", ".git", "dist", ".next", "build", "coverage",
  "__sandbox__", "data", "tests",
]);
const SCAN_ROOTS = [
  "control",
  "local-runtime",
  "software",
  "observability",
  "transport",
  "credentials",
  "contracts",
  "execution",
  "dna-os-circuit",
  "permissions",
];
const ALLOW_PREFIXES = [
  "connections/railway/",
  "connections/vercel/",
  ".railway/",
  "control/infrastructure-billing/",
  "control/owner-backbone/",
  "control/incident-remediation/",
  "control/alert-correlation/parse.ts",
  "control/alert-correlation/tests/",
  "connections/email-alert-source/",
  "control/self-resource/declarations.ts",
  "software/live-census/",
  "governance/",
  "reports/",
  "audit/",
];

function allowed(rel: string): boolean {
  const n = rel.split("\\").join("/");
  return ALLOW_PREFIXES.some((p) => n === p || n.startsWith(p));
}

function walk(dir: string, acc: string[]): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) acc.push(full);
  }
}

const files: string[] = [];
for (const root of SCAN_ROOTS) walk(join(ROOT, root), files);
const hits: string[] = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (allowed(rel)) continue;
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (DOMAIN.test(text)) hits.push(rel);
}

if (hits.length > 0) {
  console.error("FAIL provider listen domain in canonical runtime-decision path:");
  for (const h of hits) console.error(`  ${h}`);
  process.exitCode = 1;
} else {
  console.log(`PASS no provider listen domain in ${files.length} scanned runtime-decision files`);
}
