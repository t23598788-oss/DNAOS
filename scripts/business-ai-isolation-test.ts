/**
 * Business AI isolation — static security regression test (2026-10-20).
 *
 * Proves, from source, that:
 *  - the Business Cline spawn never runs with --auto-approve (no unattended
 *    shell / source-write / git from a chat request);
 *  - the local Cline worker does not auto-approve either;
 *  - Developer Plane API routes use the platform-operator guard (not ADMIN_TIER);
 *  - Developer Plane pages are gated by requirePlatformOperatorPage.
 *
 * Run: npx tsx scripts/business-ai-isolation-test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

// 1. Business Cline spawn: no unattended tool approval.
const clineSrc = read("app/api/chat/_lib/clineWorker.ts");
const spawnArgs = clineSrc.slice(clineSrc.indexOf("function argsFor"), clineSrc.indexOf("export async function runOwnerRequestViaCline"));
check(
  "clineWorker argsFor has no --auto-approve flag",
  !/["']--auto-approve["']/.test(spawnArgs),
);
check(
  "clineWorker never passes --auto-approve as an arg",
  !/["']--auto-approve["']/.test(clineSrc),
);

// 2. Local Cline worker: same rule.
const workerPath = "local-runtime/cline-worker/worker.mjs";
if (existsSync(join(ROOT, workerPath))) {
  const workerSrc = read(workerPath);
  check("local cline worker never passes --auto-approve", !/["']--auto-approve["']/.test(workerSrc));
} else {
  check("local cline worker file present", false, "missing");
}

// 3. Developer Plane API routes: platform-operator guard, not ADMIN_TIER.
// Retired from the Business build (owner 2026-10-20, dna-os-retire): absent.
for (const r of ["app/api/deploy/route.ts", "app/api/build/route.ts"]) {
  check(`${r} retired (absent from Business build)`, !existsSync(join(ROOT, r)));
}

// 4. Developer Plane pages: server-side platform-operator gate.
const devPages = [
  "app/developer/layout.tsx",
  "app/admin/ide/page.tsx",
  "app/admin/dev-loop/page.tsx",
  "app/admin/deploy/layout.tsx",
  "app/admin/dbd/layout.tsx",
];
for (const p of devPages) {
  check(`${p} retired (absent) or gated by requirePlatformOperatorPage`,
    !existsSync(join(ROOT, p)) || read(p).includes("requirePlatformOperatorPage"));
}

if (failed > 0) {
  console.log(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
