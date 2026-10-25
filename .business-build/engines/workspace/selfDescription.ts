/**
 * Self Description Interface for Workspace Lock Manager (Rule 116) and File
 * Existence Intelligence — SDRN-P1 extension, same pattern as
 * engines/documents/selfDescription.ts / engines/storage/selfDescription.ts.
 * Two exports since these are two real, distinct capabilities that happen
 * to share the engines/workspace/ folder — not one merged description.
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { SelfDescription } from "@/core/shared/types";

const ROOT = join(__dirname, "../..");
function readJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8"));
}

function calledByAndCalls(archBook: { nodes: any[]; edges: any[] }, targetFile: string) {
  const nodeId = `module:${targetFile}`;
  const archNode = archBook.nodes.find((n) => n.id === nodeId);
  const calledBy = archBook.edges.filter((e) => e.label === "imports" && e.target === nodeId).map((e) => e.source.replace(/^module:/, ""));
  const calls = archBook.edges.filter((e) => e.label === "imports" && e.source === nodeId).map((e) => e.target.replace(/^module:/, ""));
  return { archNode, calledBy, calls };
}

export function describeWorkspaceLockManager(): SelfDescription {
  const TARGET_FILE = "engines/workspace/lockManager.ts";
  const moduleRegistry = readJSON<{ modules: Record<string, any> }>("registry/module-registry.json");
  const archBook = readJSON<{ nodes: any[]; edges: any[] }>("registry/architecture-book.json");
  const roadmap = readJSON<{ capabilities: any[] }>("registry/capability-roadmap.json");
  const moduleEntry = moduleRegistry.modules[TARGET_FILE];
  const roadmapEntry = roadmap.capabilities.find((c) => c.name === "workspace-lock-manager");
  const { archNode, calledBy, calls } = calledByAndCalls(archBook, TARGET_FILE);

  return {
    identity: "Workspace Lock Manager — engines/workspace/lockManager.ts — real atomic file/registry locking via a Postgres partial unique index (workspace_locks_active_resource_idx), built directly after a real incident (2026-08-04) where a concurrent session overwrote files with zero conflict detection",
    responsibility: moduleEntry?.purpose ?? "(no module-registry.json purpose recorded)",
    owner: `layer: ${moduleEntry?.layer ?? "unknown"} — Constitution Rule 116, capability-roadmap.json #${roadmapEntry?.number ?? "?"} (status: ${roadmapEntry?.status ?? "unknown"})`,
    capabilities: ["workspace.acquire_lock", "workspace.release_lock", "workspace.get_dependents", "workspace.analyze_impact", "workspace.create_migration_plan", "workspace.approve_migration_plan", "workspace.execute_migration"],
    runtimeConnection: calledBy.length > 0 ? "partial" : "not_wired",
    runtimeConnectionNote: "Reachable via real Runtime-callable commands (registerCommand(), engines/workspace/registerCommands.ts) and directly imported by engines/storage/engine.ts's moveSafeToTrash() as a hard pre-check. No Capability->Orchestrator chain exists yet (repo-wide gap, not specific to this module).",
    calledBy,
    calls,
    resourcesNeeded: [],
    missing: ["Cannot mechanically stop a different AI session's or a human's direct file edit that bypasses engines/workspace/registryWriter.ts entirely — stated honestly in Rule 116/rule-coverage.json, same boundary as Rules 105/108."],
    status: archNode?.status === "OK" ? "READY" : archNode?.status === "BROKEN" ? "NOT_READY" : "PARTIAL",
    healthSignals: {
      architecture_book_status: archNode?.status ?? "not found in architecture-book.json",
      real_caller_count: calledBy.length,
      roadmap_status: roadmapEntry?.status ?? "unknown",
      lock_atomicity: "verified live via real concurrent-acquire test — exactly 1 winner out of N racing calls",
    },
    changedSince: ["2026-08-04 build + a real concurrency bug fixed live during HCG Phase 2.5 stabilization testing (bounded internal retry added to acquireLock)"],
    aiShouldKnow: [
      "This is the mechanism to use before editing any registry/*.json or core/shared/types.ts — see engines/workspace/registryWriter.ts (JSON files only; core/shared/types.ts itself still needs manual acquireLock/releaseLock around a Read+Edit, a real gap).",
      "Locks auto-expire (TTL, default 5 minutes) so a crashed session can never permanently deadlock a resource.",
    ],
    constraints: [],
    missingKnowledge: ["No per-module versioning scheme exists in this codebase."],
    verificationProcedure: "npx tsx local-runtime/workspace-acceptance-test.ts (real concurrent-lock-race + dependency-blocked-migration tests) + npx tsc --noEmit",
    generatedAt: new Date().toISOString(),
    source: "registry/module-registry.json, registry/architecture-book.json, registry/capability-roadmap.json, registry/CONSTITUTION.json (Rule 116)",
  };
}

export function describeFileExistenceIntelligence(): SelfDescription {
  const TARGET_FILE = "engines/workspace/destructiveActionGate.ts";
  const moduleRegistry = readJSON<{ modules: Record<string, any> }>("registry/module-registry.json");
  const archBook = readJSON<{ nodes: any[]; edges: any[] }>("registry/architecture-book.json");
  const roadmap = readJSON<{ capabilities: any[] }>("registry/capability-roadmap.json");
  const moduleEntry = moduleRegistry.modules[TARGET_FILE];
  const roadmapEntry = roadmap.capabilities.find((c) => c.name === "file-existence-intelligence-and-recovery");
  const { archNode, calledBy, calls } = calledByAndCalls(archBook, TARGET_FILE);

  return {
    identity: "File Existence Intelligence & Recovery — engines/workspace/destructiveActionGate.ts (+fileExistenceRegistry.ts, snapshotStore.ts) — real preview/snapshot/confirm gate in front of every destructive file action, built directly after a real incident (2026-08-04) where an untracked file was permanently lost via `rm -f` mid-session with zero recovery path",
    responsibility: moduleEntry?.purpose ?? "(no module-registry.json purpose recorded)",
    owner: `layer: ${moduleEntry?.layer ?? "unknown"} — Constitution Rule 116 extension, capability-roadmap.json #${roadmapEntry?.number ?? "?"} (status: ${roadmapEntry?.status ?? "unknown"})`,
    capabilities: ["file.inspect", "file.snapshot", "file.delete.preview", "file.delete.execute", "file.restore", "file.find_duplicates"],
    runtimeConnection: calledBy.length > 0 ? "partial" : "not_wired",
    runtimeConnectionNote: "Reachable via real Runtime-callable commands (registerCommand(), engines/workspace/registerFileCommands.ts). No Capability->Orchestrator chain exists yet (repo-wide gap).",
    calledBy,
    calls,
    resourcesNeeded: [],
    missing: [
      "file.reconstruct/file.compare/file.find_owner are declared in command-registry.json but NOT implemented — no real design work done on reconstruct-from-contract yet.",
      "Auto-pairing only covers exact registry declaration + canonical-sibling content comparison — import/export-graph, route-convention, and session-intent matching are not implemented.",
    ],
    status: archNode?.status === "OK" ? "READY" : archNode?.status === "BROKEN" ? "NOT_READY" : "PARTIAL",
    healthSignals: {
      architecture_book_status: archNode?.status ?? "not found in architecture-book.json",
      real_caller_count: calledBy.length,
      roadmap_status: roadmapEntry?.status ?? "unknown",
      events_actually_dispatched: "10 of 12 declared events genuinely call dispatchEvent() — verified by reading the source, not assumed",
    },
    changedSince: ["2026-08-04 build — a real bug (git_state='ignored' not covered by the original 'untracked'-only blocker check) was found and fixed live during this capability's own acceptance test"],
    aiShouldKnow: [
      "execute() NEVER succeeds without a real >=8-character confirmation_token AND zero blockers in preview() — a filename pattern like 'page 2.tsx' is only ever a hint, never sufficient to classify something as safe to discard; a real content-hash comparison against a canonical sibling is required.",
      "When execute() does run, it always moves to ~/.Trash via engines/storage/adapters/trashAdapter.ts — never a real rm/unlink, regardless of which `action` (rm/rm_f/rm_rf/unlink/trash/...) was requested.",
    ],
    constraints: [],
    missingKnowledge: ["No per-module versioning scheme exists in this codebase."],
    verificationProcedure: "npx tsx local-runtime/file-existence-acceptance-test.ts (8 real scenarios, scratch dir only, zero rm) + npx tsc --noEmit",
    generatedAt: new Date().toISOString(),
    source: "registry/module-registry.json, registry/architecture-book.json, registry/capability-roadmap.json, registry/CONSTITUTION.json (Rule 116)",
  };
}

export function describeArchitectureDriftDetector(): SelfDescription {
  const TARGET_FILE = "engines/workspace/architectureDriftDetector.ts";
  const moduleRegistry = readJSON<{ modules: Record<string, any> }>("registry/module-registry.json");
  const archBook = readJSON<{ nodes: any[]; edges: any[] }>("registry/architecture-book.json");
  const roadmap = readJSON<{ capabilities: any[] }>("registry/capability-roadmap.json");
  const moduleEntry = moduleRegistry.modules[TARGET_FILE];
  const roadmapEntry = roadmap.capabilities.find((c) => c.number === 51);
  const { archNode, calledBy, calls } = calledByAndCalls(archBook, TARGET_FILE);

  return {
    identity: "Development Machine Policy / Architecture Drift Detector — engines/workspace/architectureDriftDetector.ts — Constitution Rule 117: real evidence-based checks (lsof/ps for port 11434, ~/.ollama existence, .gguf/.safetensors weight files, live localhost:11434 fetch() calls) run every 6h piggybacked on storage-threshold-watcher.ts, alerting via LINE (architecture-drift-alert) only when NOT clean",
    responsibility: moduleEntry?.purpose ?? "(no module-registry.json purpose recorded)",
    owner: `layer: ${moduleEntry?.layer ?? "unknown"} — Constitution Rule 117, capability-roadmap.json #${roadmapEntry?.number ?? "?"} (status: ${roadmapEntry?.status ?? "unknown"})`,
    capabilities: ["workspace.detect_architecture_drift"],
    runtimeConnection: calledBy.length > 0 ? "partial" : "not_wired",
    runtimeConnectionNote: "Invoked directly by local-runtime/storage-threshold-watcher.ts every 6h (real LaunchAgent com.dnaos.storage-threshold-watcher) and by local-runtime/architecture-drift-acceptance-test.ts. No Capability->Orchestrator chain exists yet (repo-wide gap).",
    calledBy,
    calls,
    resourcesNeeded: [],
    missing: [
      "Detection is pattern-based, not exhaustive — only catches known shapes (localhost:11434, ~/.ollama, .gguf/.safetensors, live fetch() calls). A different local AI runtime/port/tool would not be caught (see roadmap #52, deferred).",
      "No UI surfaces architecture_drift_events yet — LINE alert + raw Supabase table only.",
    ],
    status: archNode?.status === "OK" ? "READY" : archNode?.status === "BROKEN" ? "NOT_READY" : "PARTIAL",
    healthSignals: {
      architecture_book_status: archNode?.status ?? "not found in architecture-book.json",
      real_caller_count: calledBy.length,
      roadmap_status: roadmapEntry?.status ?? "unknown",
      last_real_incident: "2026-08-04 — the project root folder was renamed (DNA OS-โฟลเดอร์หลักต้นฉบับ -> DNA OS-ต้นฉบับ), breaking all 4 LaunchAgents and 18 local-runtime scripts that had the old absolute path hardcoded in a PROJECT_DIR/ROOT constant or an inline argument. Fixed by repointing the 4 installed plists + repo templates, and converting all 18 scripts to compute their root dynamically via join(dirname(fileURLToPath(import.meta.url)), '..') instead of a string literal, so a future rename cannot silently break them again.",
    },
    changedSince: [
      "2026-08-04 — real incident: folder rename broke all 4 LaunchAgents (stale absolute paths) and 18 scripts (hardcoded PROJECT_DIR/ROOT/inline path constants). All 18 scripts converted to dynamic path resolution (import.meta.url-based); all 4 plists repointed and reloaded clean (verified via fresh logs + drift report clean=true); one stale protective-root reference in storage-cleanup-manager.mjs's NEVER_TOUCH_ROOTS also updated.",
    ],
    aiShouldKnow: [
      "Any new local-runtime script must derive its project root dynamically (join(dirname(fileURLToPath(import.meta.url)), '..')) — never hardcode an absolute path string. This is now a real, incident-proven rule, not a style preference.",
      "LaunchAgent plists under ~/Library/LaunchAgents/com.dnaos.*.plist have real absolute paths baked into ProgramArguments/WorkingDirectory/StandardOutPath/StandardErrorPath and must be manually repointed (and reloaded) whenever the repo's parent folder moves or is renamed — this is a real, unfixed structural gap (plists cannot self-resolve like the scripts now do).",
    ],
    constraints: [],
    missingKnowledge: ["No automated detector exists yet for 'the repo's own path just changed' — this incident was caught by manual investigation, not by this detector or any other."],
    verificationProcedure: "npx tsx local-runtime/architecture-drift-acceptance-test.ts (real machine clean=true + synthetic violation caught) + npx tsc --noEmit",
    generatedAt: new Date().toISOString(),
    source: "registry/module-registry.json, registry/architecture-book.json, registry/capability-roadmap.json, registry/CONSTITUTION.json (Rule 117)",
  };
}
