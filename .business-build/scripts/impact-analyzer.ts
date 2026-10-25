#!/usr/bin/env npx tsx
/**
 * Dev Loop Impact Analyzer (owner, 2026-08-05).
 *
 * Reads the ALREADY-GENERATED registry/module-registry.json and
 * registry/system-control-graph.json (built by sync-registry.ts /
 * build-system-control-graph.ts — this script does not recompute either,
 * per the same "reuse real infra" rule deploy-gate.ts already follows) and
 * classifies one evidence event as pass/warning/fail:
 *
 *   fail    — path has real dependents (other modules import it) AND is not
 *             registered in module-registry.json (a silent breaking change
 *             to something other code relies on).
 *   warning — path is not registered at all (no dependents found yet, but
 *             also no owner/purpose on record).
 *   pass    — path is registered, or has no code dependents.
 *
 * Writes one row to dev_loop_check_results. If the verdict is warning/fail
 * because the path is unregistered, ALSO writes a dev_loop_registry_proposals
 * row with a real, evidence-derived draft entry — status 'pending', never
 * applied to module-registry.json itself. That write stays scripts/sync-registry.ts's
 * job alone.
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname } from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(__dirname, "..");

try {
  const envFile = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1);
  }
} catch {
  // no .env.local — falls through to the missing-env-var check below
}

function readJSON<T>(relPath: string): T | null {
  const p = join(ROOT, relPath);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

function findDependents(path: string, graph: any): string[] {
  if (!graph?.edges) return [];
  const target = `module:${path}`;
  return graph.edges.filter((e: any) => e.target === target).map((e: any) => e.source.replace(/^module:/, ""));
}

interface Verdict {
  result: "pass" | "warning" | "fail";
  reason: string;
  dependents: string[];
}

function classify(path: string, moduleRegistry: any, graph: any): Verdict {
  const dependents = findDependents(path, graph);
  const registered = moduleRegistry?.modules?.[path];

  if (registered) {
    return { result: "pass", reason: `registered in module-registry.json (owner: ${registered.owner})`, dependents };
  }
  if (dependents.length > 0) {
    return {
      result: "fail",
      reason: `${dependents.length} module(s) depend on this path but it is not registered in module-registry.json — potential silent breaking change`,
      dependents,
    };
  }
  return { result: "warning", reason: "not registered in module-registry.json (no known dependents yet)", dependents };
}

async function main() {
  const evidenceEventId = process.argv[2];
  if (!evidenceEventId) {
    console.error("usage: npx tsx scripts/impact-analyzer.ts <evidence_event_id>");
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[impact-analyzer] missing Supabase env vars — cannot read/write dev_loop_* tables");
    process.exit(1);
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: event, error: eventErr } = await db.from("dev_loop_evidence_events").select("*").eq("id", evidenceEventId).single();
  if (eventErr || !event) {
    console.error("[impact-analyzer] evidence event not found:", evidenceEventId, eventErr);
    process.exit(1);
  }

  const moduleRegistry = readJSON<any>("registry/module-registry.json");
  const graph = readJSON<any>("registry/system-control-graph.json");

  if (event.event_type === "unlink") {
    const dependents = findDependents(event.path, graph);
    const verdict: Verdict = dependents.length > 0
      ? { result: "fail", reason: `file deleted but ${dependents.length} module(s) still import it`, dependents }
      : { result: "pass", reason: "file deleted, no known dependents", dependents: [] };
    await writeResult(db, event, verdict);
    return;
  }

  const verdict = classify(event.path, moduleRegistry, graph);
  const checkResultId = await writeResult(db, event, verdict);

  if (verdict.result !== "pass" && checkResultId) {
    await proposePatch(db, event, verdict, checkResultId);
  }
}

async function writeResult(db: any, event: any, verdict: Verdict): Promise<string | null> {
  const { data, error } = await db
    .from("dev_loop_check_results")
    .insert({
      evidence_event_id: event.id,
      session_id: event.session_id,
      path: event.path,
      result: verdict.result,
      reason: verdict.reason,
      dependents: verdict.dependents,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[impact-analyzer] failed to write check result:", error);
    return null;
  }
  console.log(`[impact-analyzer] ${event.path} -> ${verdict.result} (${verdict.reason})`);
  return data.id as string;
}

async function proposePatch(db: any, event: any, verdict: Verdict, checkResultId: string) {
  const absPath = join(ROOT, event.path);
  const ext = extname(event.path).replace(".", "") || "UNKNOWN";
  const draft = {
    owner: "UNASSIGNED",
    layer: event.path.split("/")[0] ?? "UNKNOWN",
    purpose: "[Auto-detected by Impact Analyzer — needs a real purpose written by the owner]",
    purpose_th: "[ตรวจพบอัตโนมัติโดย Impact Analyzer — ต้องระบุ purpose จริงโดยเจ้าของ]",
    exports: [],
    status: "unregistered",
    entry_point: false,
    file_type: ext,
    size_bytes: existsSync(absPath) ? statSync(absPath).size : null,
  };

  const { error } = await db.from("dev_loop_registry_proposals").insert({
    check_result_id: checkResultId,
    session_id: event.session_id,
    target_registry: "registry/module-registry.json",
    path: event.path,
    patch: { [event.path]: draft },
    status: "pending",
  });

  if (error) {
    console.error("[impact-analyzer] failed to write registry proposal:", error);
    return;
  }
  console.log(`[impact-analyzer] proposed registry patch for ${event.path} (pending approval)`);
}

main().catch((e) => {
  console.error("[impact-analyzer] fatal:", e);
  process.exit(1);
});
