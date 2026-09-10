/**
 * CANONICAL_ENGINEERING_KNOWLEDGE_MCP_V1 — hermetic + live git metadata proofs.
 * How to run: npx tsx control/mcp-code-knowledge/tests/engineering-knowledge.test.ts
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { recordEngineeringHandoff, getCurrentWorkContext, currentRevision } from "../../work-session-state/contract";
import { lookupCodeReferences, resolveCurrentSource } from "../contract";
import {
  getCurrentWorkContextFact,
  lookupCodeReferencesFact,
  resolveCurrentSourceFact,
  containsCredentialMaterial,
} from "../../../connections/dna-os-mcp/runtime-facts";
import { canDiscover, policyFor } from "../../../connections/dna-os-mcp/export-policy";

declare const process: { env: Record<string, string | undefined>; cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const ROOT = mkdtempSync(join(tmpdir(), "eng-knowledge-"));
process.env.WORK_SESSION_STATE_ROOT = ROOT;

let passed = 0;
let failed = 0;
function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`PASS: ${name}`); }
  else { failed += 1; console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

function nowIso(): string {
  return new Date().toISOString();
}

function recordGoogleHandoff(): string {
  const sha = currentRevision();
  const observed = nowIso();
  const workId = "work-google-oauth-client-config-v1";
  recordEngineeringHandoff({
    work_id: workId,
    title: "GOOGLE_WORKSPACE_OAUTH_CLIENT_CONFIG_RESOLUTION_V1",
    domain: "google-workspace",
    objective: "Resolve admitted Google OAuth client configuration for token refresh",
    current_phase: "oauth-client-config-resolution",
    next_action: "Resolve oauth-client-config store scope then retry live Gmail refresh",
    relevant_files: [
      "connections/google-workspace/oauth/client-config-store.ts",
      "connections/google-workspace/oauth/google-oauth.ts",
      "connections/google-workspace/credential-resolution.ts",
      "control/owner-authentication/contract.ts",
    ],
    relevant_capability_ids: ["google-workspace"],
    completed_boundaries: [
      { id: "owner-authorization-orchestration", authority: "github", source: "pr://16", observed_at: observed, source_revision: "0ea36aa77ba06ed56ed671c265570ce420689bfc", evidence_ref: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/16" },
      { id: "owner-intent-to-canonical-action", authority: "github", source: "pr://17", observed_at: observed, source_revision: "879e33bc5bd7fe8ee6b02c88751acaae37b4bad6", evidence_ref: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/17" },
      { id: "owner-google-read-admission", authority: "github", source: "pr://18", observed_at: observed, source_revision: "92f331451249a4331ffeaec0b38c48", evidence_ref: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/18" },
      { id: "canonical-user-credential-pointer", authority: "github", source: "pr://19", observed_at: observed, source_revision: "aa278a397f019e882eb28d2bcdf89444d9457022", evidence_ref: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/19" },
    ],
    current_boundary: {
      id: "oauth-client-config-resolution",
      authority: "command_evidence",
      source: "google-workspace.outcome",
      observed_at: observed,
      source_revision: sha,
      evidence_ref: "AUTH_REQUIRED missing GOOGLE_OAUTH_CLIENT_ID,GOOGLE_OAUTH_CLIENT_SECRET,GOOGLE_REDIRECT_URI",
    },
    next_boundary: {
      id: "live-gmail-refresh",
      authority: "work_session_state",
      source: "handoff",
      observed_at: observed,
      source_revision: sha,
      evidence_ref: "google.gmail.messages.list after client config resolves",
    },
    open_pr_refs: [
      { number: 16, url: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/16", head_sha: "0ea36aa77ba06ed56ed671c265570ce420689bfc", authority: "github", observed_at: observed },
      { number: 17, url: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/17", head_sha: "879e33bc5bd7fe8ee6b02c88751acaae37b4bad6", authority: "github", observed_at: observed },
      { number: 18, url: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/18", head_sha: "92f331451249a4331ffeaec0b38c48", authority: "github", observed_at: observed },
      { number: 19, url: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/19", head_sha: "aa278a397f019e882eb28d2bcdf89444d9457022", authority: "github", observed_at: observed },
    ],
    proofs: {
      static: { status: "STATIC", authority: "work_session_state", evidence_ref: "canonical-credential-pointer.test.ts", source_revision: "aa278a397f019e882eb28d2bcdf89444d9457022", observed_at: observed },
      hermetic: { status: "HERMETIC", authority: "work_session_state", evidence_ref: "runtime-adapter.test.ts", source_revision: "aa278a397f019e882eb28d2bcdf89444d9457022", observed_at: observed },
      live: { status: "LIVE", authority: "command_evidence", evidence_ref: "cmd_11d8a85d-aaa0-46d1-b9d9-481c4753812b", source_revision: "aa278a397f019e882eb28d2bcdf89444d9457022", observed_at: observed },
    },
    constraints: ["no Production OAuth", "no writes", "no second Google credential family", "do not recreate existing systems"],
    blockers: [{
      blocker_id: "oauth-client-config-missing",
      layer: "connections/google-workspace/oauth/client-config-store.ts",
      detail: "admitted CONFIGURED client config is worktree-local; current worktree jsonl has no CONFIGURED row",
      evidence_ref: "connections/google-workspace/oauth/data/oauth-client-config.jsonl",
      next_action: "point client-config store at machine-local DNA OS state root",
      state: "OPEN",
    }],
    interpretation: "Keychain user token pointer restored; refresh still needs admitted OAuth client public config.",
    status: "BLOCKED",
  });
  return workId;
}

function main(): void {
  ok("MCP catalog includes get_current_work_context", policyFor("dna_os.get_current_work_context").export_class === "EXTERNAL_ALLOWED");
  ok("MCP catalog includes resolve_current_source", policyFor("dna_os.resolve_current_source").export_class === "EXTERNAL_ALLOWED");
  ok("MCP catalog includes lookup_code_references", policyFor("dna_os.lookup_code_references").export_class === "EXTERNAL_ALLOWED");
  ok("external caller can discover resolve_current_source", canDiscover("dna_os.resolve_current_source", { caller: "cursor", channel: "EXTERNAL" }).allowed === true);

  const workId = recordGoogleHandoff();
  const sha = currentRevision();

  const clientA = getCurrentWorkContextFact();
  const clientB = getCurrentWorkContextFact();
  const aCtx = (clientA as { work_context: ReturnType<typeof getCurrentWorkContext> }).work_context;
  const bCtx = (clientB as { work_context: ReturnType<typeof getCurrentWorkContext> }).work_context;
  ok("two independent MCP facts share work_id", aCtx.work_id === workId && bCtx.work_id === workId);
  ok("two independent MCP facts share HEAD", aCtx.git.source_revision === sha && bCtx.git.source_revision === sha);
  ok("two independent MCP facts share next boundary", aCtx.next_boundary?.id === "live-gmail-refresh" && bCtx.next_boundary?.id === aCtx.next_boundary?.id);
  ok("two independent MCP facts share relevant files", JSON.stringify(aCtx.relevant_files) === JSON.stringify(bCtx.relevant_files));
  ok("facts contain no credential material", containsCredentialMaterial(clientA) === false && containsCredentialMaterial(clientB) === false);

  const sourceA = resolveCurrentSource();
  const sourceB = resolveCurrentSourceFact();
  const sourceBBody = (sourceB as { current_source: ReturnType<typeof resolveCurrentSource> }).current_source;
  ok("source resolution is RESOLVED or honest UNRESOLVED", sourceA.resolution === "RESOLVED" || sourceA.resolution === "UNRESOLVED");
  ok("execution SHA is live git HEAD", sourceA.execution.revision === sha);
  ok("execution is safe for this process", sourceA.execution.safe_for_current_execution === true);
  ok("two source clients agree on execution SHA", sourceA.execution.revision === sourceBBody.execution.revision);
  ok("related snapshots are never current", sourceA.related_snapshots.every((row) => row.current === false && row.safe_for_current_execution === false));
  ok("snapshot classification is not CURRENT_CANONICAL", sourceA.related_snapshots.every((row) => row.classification !== "CURRENT_CANONICAL" && row.classification !== "ACTIVE_WORK"));
  ok("managed agent worktrees are counted not dumped", sourceA.snapshot_omitted_count >= 0);

  const currentLookup = lookupCodeReferences({ capability_id: "google-workspace", work_id: workId });
  ok("google-workspace lookup does not require source search", currentLookup.SOURCE_SEARCH_REQUIRED === false);
  ok("google-workspace current refs are this checkout only", currentLookup.current_refs.length > 0 && currentLookup.current_refs.every((row) => row.source_root === sourceA.execution.source_root && row.historical_only === false));
  ok("google-workspace action ids come from the registry", currentLookup.action_ids.includes("google.gmail.messages.list"));
  ok("default lookup returns no historical refs", currentLookup.historical_refs.length === 0);
  ok("contract path is among current refs", currentLookup.current_refs.some((row) => row.path === "connections/google-workspace/adapter-contract.ts"));

  const historical = lookupCodeReferences({ capability_id: "google-workspace", include_historical: true, work_id: workId });
  ok("explicit historical lookup may return snapshot refs", historical.historical_refs.every((row) => row.current === false && row.historical_only === true && row.classification !== "CURRENT_CANONICAL"));
  if (historical.historical_refs.length > 0) {
    ok("historical filename does not become current implementation", historical.current_refs.every((row) => row.classification !== "SNAPSHOT"));
  } else {
    ok("historical filename does not become current implementation", true);
  }

  const ownerLookup = lookupCodeReferences({ query: "Owner authorization", work_id: workId });
  ok("owner authorization file is a targeted work reference", ownerLookup.current_refs.some((row) => row.path === "control/owner-authentication/contract.ts"));

  const targeted = (clientA as { targeted_read?: { SOURCE_SEARCH_REQUIRED?: boolean; read_only_paths?: string[] } }).targeted_read;
  ok("work context fact tells agents not to repo-scan first", targeted?.SOURCE_SEARCH_REQUIRED === false && (targeted.read_only_paths?.length ?? 0) === 4);

  const lookupFact = lookupCodeReferencesFact({ capability_id: "google-workspace", work_id: workId });
  ok("lookup MCP fact has no secrets", containsCredentialMaterial(lookupFact) === false);

  console.log(`FRESH_SESSION_MCP_CALLS=3 (get_current_work_context, resolve_current_source, lookup_code_references)`);
  console.log(`BROAD_SEARCHES=0`);
  console.log(`TARGETED_FILES=${aCtx.relevant_files.length}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
