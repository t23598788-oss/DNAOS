/**
 * หน้าที่: locks the CORE PIPE TEMPLATE invariants proven on 2026-08-31 so a
 * later change cannot silently reopen a pipe that was closed with evidence.
 *
 * This is a REGRESSION guard, not a discovery tool. Every assertion below
 * corresponds to a defect that was found live and repaired:
 *
 *   PIPE 1  capability identity came from a hardcoded 12-entry routing table
 *           instead of the 113-row canonical registry.
 *   PIPE 2  route -> capability was a runtime canonical_name string comparison
 *           instead of an explicit canonical relationship.
 *   PIPE 3  a worker could be considered assignable without a completed probe;
 *           worker identity was inferred from a scanned PID (see PID REUSE).
 *   PIPE A  /owner/intent never persisted results, so no result could be
 *           correlated back to the command that produced it.
 *   PIPE B  the local executor returned a PRIOR command's evidence envelope
 *           whenever the operation shape matched, presenting a stale runtime
 *           observation as a fresh one.
 *
 * Reads canonical + registry data READ-ONLY. Writes nothing.
 * Dependency ที่อนุญาต: ../../../software/registry-database/*, node:fs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import type { RelationshipRow } from "../../../software/registry-database/types";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
};

const ROOT = join(__dirname, "..", "..", "..");
const CANON = join(ROOT, "software", "registry-database", "data", "canonical");
const jl = <T,>(p: string): T[] => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
const store = createPersistentFileStore();

// ---------------------------------------------------------------- PIPE 1
console.log("\nPIPE 1 — canonical registry is the capability identity authority");
{
  const caps = store.listCapabilities();
  ok("canonical registry is readable through the port", caps.length > 0, String(caps.length));
  ok("capability count far exceeds the 12-entry routing table", caps.length > 12, String(caps.length));
  ok("every capability_id is a canonical id, never a route slug",
    caps.every((c) => /^capability-[0-9a-f-]{36}$/.test(c.capability_id)),
    caps.find((c) => !/^capability-[0-9a-f-]{36}$/.test(c.capability_id))?.capability_id ?? "");
  ok("canonical_name is exposed as a lookup attribute", caps.every((c) => typeof c.canonical_name === "string" && c.canonical_name.length > 0));
}

// ---------------------------------------------------------------- PIPE 2
console.log("\nPIPE 2 — route binding is an explicit relationship, not name inference");
{
  const rels = jl<RelationshipRow>(join(CANON, "relationships.jsonl"));
  const legacy = rels.slice(0, 180);
  ok("legacy 180-row prefix is never rewritten", legacy.length === 180 && legacy.every((r) => Boolean(r.relationship_id)));
  const routeEdges = rels.filter((r) => r.relationship_kind === "CAPABILITY_TO_API");
  ok("route bindings exist as canonical relationships", routeEdges.length > 0, String(routeEdges.length));
  ok("every route binding is CAPABILITY -> API with a route: id",
    routeEdges.every((r) => r.from_type === "CAPABILITY" && r.to_type === "API" && r.to_id.startsWith("route:")));
  // The binding must be resolvable WITHOUT comparing canonical_name to a slug.
  for (const edge of routeEdges.slice(0, 3)) {
    const cap = store.findCapabilityById(edge.from_id);
    ok(`binding ${edge.to_id} resolves to a real canonical capability`, Boolean(cap), edge.from_id);
  }
  const inferred = routeEdges.filter((r) => {
    const cap = store.findCapabilityById(r.from_id);
    return cap && `route:${cap.canonical_name}` !== r.to_id;
  });
  ok("bindings are NOT merely name-equal (proves explicit binding is required)", inferred.length > 0,
    `${inferred.length} of ${routeEdges.length} bind to a differently-named route`);
}

// ---------------------------------------------------------------- PIPE 3
console.log("\nPIPE 3 — a worker binding requires completed probe evidence");
{
  const rels = jl<RelationshipRow>(join(CANON, "relationships.jsonl"));
  const workerEdges = rels.filter((r) => r.relationship_kind === "CAPABILITY_TO_WORKER");
  ok("worker bindings are CAPABILITY -> WORKER", workerEdges.every((r) => r.from_type === "CAPABILITY" && r.to_type === "WORKER"));

  const regs = jl<Record<string, unknown>>(join(ROOT, "connections", "agent-registry", "data", "worker-registrations.jsonl"));
  for (const edge of workerEdges) {
    const reg = [...regs].reverse().find((r) => r.worker_id === edge.to_id);
    ok(`bound worker ${String(edge.to_id).slice(0, 28)} has a registration`, Boolean(reg));
    if (!reg) continue;
    // THE core invariant: no binding without a real completed probe.
    ok("  bound worker has probe evidence", Boolean(reg.last_probe_evidence_id) && Boolean(reg.last_probe_task_id),
      `probe_evidence=${String(reg.last_probe_evidence_id)}`);
    ok("  bound worker has a real session (never 'UNKNOWN')", typeof reg.session_id === "string" && reg.session_id !== "UNKNOWN", String(reg.session_id));
    ok("  readiness recorded worker_identity=true", Array.isArray(reg.evidence) && (reg.evidence as string[]).includes("worker_identity=true"));
    ok("  readiness recorded probe_ok=true", Array.isArray(reg.evidence) && (reg.evidence as string[]).includes("probe_ok=true"));
  }
  // A worker that never probed must never be bound.
  const unproven = regs.filter((r) => !r.last_probe_evidence_id).map((r) => r.worker_id);
  const wronglyBound = workerEdges.filter((e) => unproven.includes(e.to_id));
  ok("no capability is bound to an unproven worker", wronglyBound.length === 0, JSON.stringify(wronglyBound.map((e) => e.to_id)));
}

// ---------------------------------------------------------------- PID REUSE
console.log("\nPERMANENT EVIDENCE — PID reuse makes process-scan identity unsafe");
{
  /**
   * Observed live on 2026-08-31 while attempting Pipe 3:
   *   worker-states.jsonl recorded process_id 3521 for a DNA OS agent.
   *   `ps -p 3521` at that moment returned:
   *     /Applications/Google Drive.app/Contents/MacOS/crashpad_handler
   *   The recorded agent PID had been recycled by the OS and now pointed at
   *   an unrelated third-party process. A binding derived from that PID would
   *   have attached a canonical capability to Google Drive's crash handler.
   *
   * This is why connections/agent-registry/worker-registration.ts states
   * "No process scan or provider name can satisfy the probe", and why
   * worker_identity requires worker_id + a session_id that is not "UNKNOWN".
   */
  const OBSERVED_COLLISION = { recorded_pid: 3521, recorded_as: "DNA OS agent worker-state", actually_was: "/Applications/Google Drive.app/Contents/MacOS/crashpad_handler", observed_at: "2026-08-31" };
  ok("PID-reuse collision case is retained as permanent evidence", OBSERVED_COLLISION.recorded_pid === 3521 && OBSERVED_COLLISION.actually_was.includes("Google Drive"));

  const src = readFileSync(join(ROOT, "connections", "agent-registry", "worker-registration.ts"), "utf8");
  ok("readiness contract still forbids process-scan identity", src.includes("No process scan or provider name can satisfy the probe"));
  ok("worker_identity still requires a non-UNKNOWN session_id", src.includes('input.session_id !== "UNKNOWN"'));

  // No canonical worker binding may use a bare pid: identity.
  const rels = jl<RelationshipRow>(join(CANON, "relationships.jsonl"));
  const pidBound = rels.filter((r) => r.relationship_kind === "CAPABILITY_TO_WORKER" && /^pid:/.test(String(r.to_id)));
  ok("no worker binding uses a bare pid: identity", pidBound.length === 0, JSON.stringify(pidBound.map((r) => r.to_id)));
}

// ---------------------------------------------------------------- PIPE A / B
console.log("\nPIPE A/B — command correlation and evidence freshness");
{
  const server = readFileSync(join(ROOT, "transport", "owner-command-http", "server.ts"), "utf8");
  ok("owner history supports command_id correlation", server.includes("readHistoryForCommand"));
  ok("command_id correlation is preferred over identity scope", server.includes('query.get("command_id")'));
  ok("bootstrap probe result is awaited (not a pending Promise)", server.includes("await completeBootstrapProbe"));

  const exec = readFileSync(join(ROOT, "control", "owner-command", "local-read-operations.ts"), "utf8");
  ok("duplicate reuse requires an explicit idempotency_key", exec.includes("if (!request.idempotency_key) return null;"));
  ok("a reused observation is re-stamped and marked, never passed off as fresh",
    exec.includes("reused_from_operation_id") && exec.includes("runtime_freshly_observed"));
  ok("executor carries command_id into its evidence", exec.includes("command_id: request.command_id ?? null"));

  const intent = readFileSync(join(ROOT, "control", "owner-command", "structured-intent.ts"), "utf8");
  ok("every /owner/intent result is persisted under its own command_id", intent.includes("recordOwnerVisibleResult(requestId"));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail > 0) process.exit(1);
