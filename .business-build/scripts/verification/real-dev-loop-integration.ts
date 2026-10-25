#!/usr/bin/env npx tsx
/**
 * Bounded real integration test for the dev-loop pipeline.
 *
 * Writes only test rows to dev_loop_* tables, never registry/*.json. It does
 * not start scripts/watch-registry.ts because that watcher also runs the
 * legacy sync-registry writer. It never calls OpenAI, Deploy Gate, git, or
 * any external AI runtime.
 */
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { startSession, closeSession } from "../../engines/workspace/devLoopSession";
import { logEvidenceEvent } from "../../engines/workspace/evidenceStore";
import { execFileSync } from "child_process";

const ROOT = join(__dirname, "../..");

function loadEnv() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1);
  }
}

async function main() {
  loadEnv();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase credentials are required for this bounded integration test");
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const tempRel = `.tmp-dev-loop-real-${process.pid}`;
  const tempAbs = join(ROOT, tempRel);
  const fixtureRel = `${tempRel}/unregistered-fixture.ts`;
  let sessionId: string | null = null;
  mkdirSync(tempAbs, { recursive: true });
  writeFileSync(join(tempAbs, "unregistered-fixture.ts"), "export const realIntegrationFixture = true;\n", "utf8");

  try {
    const session = await startSession(db, {
      owner: "codex-real-integration-test",
      goal: "bounded File Watcher to Deploy Gate evidence test",
      fileScope: [fixtureRel],
    });
    sessionId = session.id;

    const evidence = await logEvidenceEvent(db, session.id, fixtureRel, "add");
    const analyzerOutput = execFileSync("npx", ["tsx", "scripts/impact-analyzer.ts", evidence.id], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    const check = await db.from("dev_loop_check_results").select("id, evidence_event_id, session_id, path, result, reason").eq("evidence_event_id", evidence.id).order("checked_at", { ascending: false }).limit(1).single();
    if (check.error || !check.data) throw new Error(`impact result not found: ${check.error?.message ?? "unknown"}`);
    if (check.data.session_id !== session.id || check.data.path !== fixtureRel) throw new Error("impact result lost session/path linkage");

    const proposal = await db.from("dev_loop_registry_proposals").select("id, check_result_id, session_id, path, target_registry, status").eq("check_result_id", check.data.id).single();
    if (proposal.error || !proposal.data) throw new Error(`proposal not found: ${proposal.error?.message ?? "unknown"}`);
    if (proposal.data.session_id !== session.id || proposal.data.status !== "pending" || proposal.data.target_registry !== "registry/module-registry.json") throw new Error("proposal boundary/linkage is invalid");

    console.log(JSON.stringify({
      ok: true,
      session_id: session.id,
      evidence_event_id: evidence.id,
      check_result_id: check.data.id,
      proposal_id: proposal.data.id,
      impact_result: check.data.result,
      proposal_status: proposal.data.status,
      analyzer_output: analyzerOutput.trim(),
      registry_written: false,
      deploy_executed: false,
      openai_called: false,
    }, null, 2));
  } finally {
    if (sessionId) await closeSession(db, sessionId).catch(() => undefined);
    if (existsSync(tempAbs)) rmSync(tempAbs, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), registry_written: false, deploy_executed: false, openai_called: false }, null, 2));
  process.exitCode = 1;
});
