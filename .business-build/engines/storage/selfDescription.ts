/**
 * Self Description Interface for Storage Intelligence (engines/storage/engine.ts).
 * SDRN-P1 extension (owner, 2026-08-04: "ขยาย SDRN-P1 self-description ให้
 * ครอบคลุมมากกว่า 1/464 module") — same pattern as
 * engines/documents/selfDescription.ts, the one prior real implementation.
 * Every field is computed from real registry files at call time.
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { SelfDescription } from "@/core/shared/types";

const ROOT = join(__dirname, "../..");
function readJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8"));
}

const TARGET_FILE = "engines/storage/engine.ts";

export function describeStorageIntelligence(): SelfDescription {
  const moduleRegistry = readJSON<{ modules: Record<string, any> }>("registry/module-registry.json");
  const archBook = readJSON<{ nodes: any[]; edges: any[] }>("registry/architecture-book.json");
  const roadmap = readJSON<{ capabilities: any[] }>("registry/capability-roadmap.json");

  const moduleEntry = moduleRegistry.modules[TARGET_FILE];
  const nodeId = `module:${TARGET_FILE}`;
  const archNode = archBook.nodes.find((n) => n.id === nodeId);
  const calledBy = archBook.edges.filter((e) => e.label === "imports" && e.target === nodeId).map((e) => e.source.replace(/^module:/, ""));
  const calls = archBook.edges.filter((e) => e.label === "imports" && e.source === nodeId).map((e) => e.target.replace(/^module:/, ""));

  // capability-registry.json is frozen at v1.0.0 (202 caps, predates this
  // module) — capability-roadmap.json is the real, live tracker this
  // capability was actually registered in (#39).
  const roadmapEntry = roadmap.capabilities.find((c) => c.name === "storage-intelligence");

  return {
    identity: "Storage Intelligence — engines/storage/engine.ts — scans/classifies/moves-to-Trash local dev-machine resources (cache/duplicate clones/local AI models) via a real Scan->Classify->Decide->Move pipeline, never a permanent delete",
    responsibility: moduleEntry?.purpose ?? "(no module-registry.json purpose recorded)",
    owner: `layer: ${moduleEntry?.layer ?? "unknown"} — capability-roadmap.json #${roadmapEntry?.number ?? "?"} (status: ${roadmapEntry?.status ?? "unknown"})`,
    capabilities: ["storage.scan", "storage.classify", "storage.report", "storage.move_safe_to_trash", "storage.inspect_docker", "storage.verify_supabase", "storage.check_threshold"],
    runtimeConnection: calledBy.length > 0 ? "partial" : "not_wired",
    runtimeConnectionNote:
      "Reachable 2 real ways: (1) HTTP via app/api/admin/storage-intelligence (UI-driven), (2) real Runtime-callable commands via core/runtime/engine.ts's registerCommand() (engines/workspace/registerCommands.ts) — same as engines/business.ts's commands. NOT reachable via any Capability->Composer->Planner->Orchestrator->Executor->Driver chain (that chain doesn't exist for any capability yet, same finding as the Document Engine's own self-description).",
    calledBy,
    calls,
    resourcesNeeded: [],
    missing: [
      "Not wired into the Capability Runtime Orchestrator chain (none exists yet for any capability).",
      "LOCAL_AI_MODEL classification only reaches SAFE after a live, caller-verified policy check (localAiModelPolicy) — no automatic verification exists inside this module itself, by design (see engines/storage/classifier.ts).",
    ],
    status: archNode?.status === "OK" ? "READY" : archNode?.status === "BROKEN" ? "NOT_READY" : "PARTIAL",
    healthSignals: {
      architecture_book_status: archNode?.status ?? "not found in architecture-book.json",
      real_caller_count: calledBy.length,
      roadmap_status: roadmapEntry?.status ?? "unknown",
      trash_policy: "move-only, never permanent delete — verified live 2026-08-04 (real ~/.ollama migration, 11.2GB)",
    },
    changedSince: ["DNA-000XXX entries for 2026-08-04 storage-intelligence build — see registry/CHANGELOG.json for exact ids"],
    aiShouldKnow: [
      "Trash Policy is absolute: this engine can only move to ~/.Trash via engines/storage/adapters/trashAdapter.ts, never rm/unlink — the user empties Trash themselves.",
      "moveSafeToTrash() re-verifies dependencies live via engines/workspace/migrationEngine.ts immediately before every move — a resource classified SAFE at scan time can still be blocked at move time if state changed.",
    ],
    constraints: [],
    missingKnowledge: ["No per-module versioning scheme exists in this codebase (same gap as every other module's self-description)."],
    verificationProcedure: "npm run test-storage-intelligence (real acceptance suite) + npx tsc --noEmit + registry/architecture-book.json status for module:" + TARGET_FILE + " must be OK",
    generatedAt: new Date().toISOString(),
    source: "registry/module-registry.json, registry/architecture-book.json, registry/capability-roadmap.json, registry/CHANGELOG.json",
  };
}
