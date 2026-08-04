// One-off smoke test for the storage-intelligence engine — scan + classify +
// report only, never moves anything. Run with: npx tsx local-runtime/storage-smoke-test.ts
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { scanStorage, classifyScan, report } from "@/engines/storage/engine";
import { fileURLToPath } from "url";
import { dirname } from "path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  const { scanRunId, resources } = await scanStorage(db, "smoke-test");
  console.log(`scan: ${resources.length} resources found, scanRunId=${scanRunId}`);

  const { resources: classified } = await classifyScan(db, scanRunId, "smoke-test");
  for (const r of classified) {
    console.log(`  ${r.state.padEnd(9)} ${r.classification.classification.padEnd(20)} conf=${r.classification.confidence.toFixed(2)} ${r.path}`);
  }

  const rep = await report(db, scanRunId);
  console.log(`\nfree=${(rep.free_bytes / 1e9).toFixed(1)}GB target=150GB gap=${(rep.gap_bytes / 1e9).toFixed(1)}GB safe_total=${(rep.total_safe_bytes / 1e9).toFixed(2)}GB`);
  console.log(`SAFE=${rep.safe.length} BLOCKED=${rep.blocked.length} UNKNOWN=${rep.unknown.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
