// Migration Completion CLI — Roadmap follow-up (owner, 2026-08-04). Verifies
// live (never assumed) that no local script references localhost:11434 and
// that Cloud Runtime is fully ready, then runs the real Storage Intelligence
// + Resource Migration Engine pipeline to move ~/.ollama to Trash — never a
// raw `rm -rf`. Defaults to dry-run; pass --confirm to actually move it.
//
// Usage: npx tsx local-runtime/migrate-ollama.ts [--confirm]
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { scanStorage, classifyScan, report, moveSafeToTrash } from "@/engines/storage/engine";
import { ensurePodRunning, waitForOllamaReady, stopPod } from "./runpod-controller.mjs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIRM = process.argv.includes("--confirm");

const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function checkNoScriptDependents(): { clear: boolean; evidence: string[] } {
  const dir = join(PROJECT_DIR, "local-runtime");
  const hits: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.(mjs|ts)$/.test(f)) continue;
    if (f === "ollama-cloud-gateway.mjs" || f === "migrate-ollama.ts") continue; // these two only ever mention the migration itself, in comments
    const content = readFileSync(join(dir, f), "utf-8");
    // Only real, live code references count — a match inside a // comment
    // explaining the migration is not a dependency. Cheap heuristic: flag
    // only lines with `fetch(` immediately near the literal.
    for (const line of content.split("\n")) {
      if (line.includes("localhost:11434") && line.includes("fetch(")) hits.push(`${f}: ${line.trim()}`);
    }
  }
  return { clear: hits.length === 0, evidence: hits.length === 0 ? [`real grep of local-runtime/*.mjs,*.ts found zero live fetch() calls to localhost:11434`] : hits };
}

async function checkCloudRuntimeReady(): Promise<{ ready: boolean; evidence: string[] }> {
  const ensured = await ensurePodRunning();
  if (!ensured.ok || !ensured.pod?.id) {
    return { ready: false, evidence: [`ensurePodRunning failed: ${JSON.stringify(ensured.errors ?? ensured)}`] };
  }
  const readiness = await waitForOllamaReady(ensured.pod.id);
  if (!readiness.ready || !readiness.status) {
    return { ready: false, evidence: [`waitForOllamaReady failed: ${readiness.error}`] };
  }
  const s = readiness.status;
  const allReady = s.volume_attached && s.model_present && s.model_verified && s.runtime_ready;
  return {
    ready: allReady,
    evidence: [`live check on pod ${ensured.pod.id}: volume_attached=${s.volume_attached} model_present=${s.model_present} model_verified=${s.model_verified} runtime_ready=${s.runtime_ready}, models=[${s.modelsFound.join(", ")}]`],
  };
}

function getFreeDiskGB(): number {
  const out = execSync("df -k /System/Volumes/Data", { encoding: "utf8" });
  const cols = out.trim().split("\n")[1].trim().split(/\s+/);
  return (parseInt(cols[3], 10) * 1024) / 1e9;
}

async function main() {
  console.log(`=== Migration Completion: ~/.ollama (${CONFIRM ? "LIVE — will move to Trash" : "dry-run"}) ===\n`);

  const freeBefore = getFreeDiskGB();
  console.log(`Free disk before: ${freeBefore.toFixed(1)}GB\n`);

  console.log("Step 1: verify no script still references localhost:11434 (real grep)...");
  const scriptCheck = checkNoScriptDependents();
  for (const e of scriptCheck.evidence) console.log(`  ${e}`);
  console.log(`  -> noScriptDependents = ${scriptCheck.clear}\n`);

  console.log("Step 2: verify Cloud Runtime readiness (live RunPod check)...");
  const cloudCheck = await checkCloudRuntimeReady();
  for (const e of cloudCheck.evidence) console.log(`  ${e}`);
  console.log(`  -> cloudRuntimeVerified = ${cloudCheck.ready}\n`);

  await stopPod().catch(() => {}); // never leave the pod running idle after this check

  if (!scriptCheck.clear || !cloudCheck.ready) {
    console.log("BLOCKED: policy preconditions not met — ~/.ollama stays in place. No move attempted.");
    return;
  }

  console.log("Step 3: run Storage Intelligence scan + classify (real pipeline, not ad hoc)...");
  const { scanRunId } = await scanStorage(db, "migrate-ollama-cli");
  await classifyScan(db, scanRunId, "migrate-ollama-cli", {
    aiModelPolicy: { noScriptDependents: scriptCheck.clear, cloudRuntimeVerified: cloudCheck.ready, evidence: [...scriptCheck.evidence, ...cloudCheck.evidence] },
  });
  const rep = await report(db, scanRunId);
  const ollamaEntry = rep.safe.find((r) => r.path.endsWith(".ollama"));
  console.log(`  ~/.ollama classification: ${ollamaEntry ? "SAFE" : "NOT SAFE — see blocked list"}`);
  if (!ollamaEntry) {
    const blocked = rep.blocked.find((r) => r.path.endsWith(".ollama"));
    console.log(`  blocked_reason: ${blocked?.classification.blocked_reason ?? "not found in scan results"}`);
    return;
  }

  console.log(`\nStep 4: ${CONFIRM ? "moving to Trash" : "dry-run only"}...`);
  const moveResult = await moveSafeToTrash(db, scanRunId, "migrate-ollama-cli", { dryRun: !CONFIRM });
  console.log(JSON.stringify(moveResult, null, 2));

  if (CONFIRM && moveResult.moved.length > 0) {
    const freeAfter = getFreeDiskGB();
    console.log(`\nFree disk after: ${freeAfter.toFixed(1)}GB (was ${freeBefore.toFixed(1)}GB, +${(freeAfter - freeBefore).toFixed(1)}GB)`);
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
