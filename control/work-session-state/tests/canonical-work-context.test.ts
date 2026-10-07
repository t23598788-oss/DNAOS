/**
 * CANONICAL_WORK_CONTEXT_REGISTRY_V1 — hermetic proofs.
 * How to run: npx tsx control/work-session-state/tests/canonical-work-context.test.ts
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { getCapability } from "../../command-router/contract";
import { currentRevision } from "../store";
import {
  getCurrentWorkContext,
  recordEngineeringHandoff,
  journalPath,
  appendCheckpoint,
  currentCheckpoint,
} from "../contract";
import { getCurrentWorkContextFact } from "../../../connections/dna-os-mcp/runtime-facts";
import { containsCredentialMaterial } from "../../../connections/dna-os-mcp/runtime-facts";

declare const process: { env: Record<string, string | undefined>; cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const ROOT = mkdtempSync(join(tmpdir(), "work-context-"));
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

function main(): void {
  const empty = getCurrentWorkContext();
  ok("empty journal is honest NO_SUCH_WORK", empty.resume.resume_status === "NO_SUCH_WORK" && empty.work_id === null);
  ok("git authority is live HEAD", empty.git.authority === "git" && /^[0-9a-f]{40}$/.test(empty.git.source_revision));
  ok("runtime authority is present", empty.runtime.authority === "runtime");

  const sha = currentRevision();
  const observed = nowIso();
  const workId = "work-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  let secretRefused = false;
  try {
    recordEngineeringHandoff({
      work_id: workId,
      title: "x",
      domain: "x",
      next_action: "x",
      relevant_files: [],
      interpretation: "client_secret=should-not-store",
    });
  } catch (error) {
    secretRefused = error instanceof Error && error.message.startsWith("WORK_CONTEXT_SECRET_REFUSED");
  }
  ok("handoff refuses secret-shaped interpretation", secretRefused);

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
      "credentials/registry/api-credential-registry.ts",
    ],
    relevant_capability_ids: ["google-workspace"],
    completed_boundaries: [
      { id: "owner-authorization-orchestration", authority: "github", source: "pr://16", observed_at: observed, source_revision: "0ea36aa77ba06ed56ed671c265570ce420689bfc", evidence_ref: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/16" },
      { id: "owner-intent-to-canonical-action", authority: "github", source: "pr://17", observed_at: observed, source_revision: "879e33bc5bd7fe8ee6b02c88751acaae37b4bad6", evidence_ref: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/17" },
      { id: "owner-google-read-admission", authority: "github", source: "pr://18", observed_at: observed, source_revision: "92f331451249a4331ffeaec0b0ac6eab80b38c48", evidence_ref: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/18" },
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
      { number: 18, url: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/18", head_sha: "92f331451249a4331ffeaec0b0ac6eab80b38c48", authority: "github", observed_at: observed },
      { number: 19, url: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/pull/19", head_sha: "aa278a397f019e882eb28d2bcdf89444d9457022", authority: "github", observed_at: observed },
    ],
    proofs: {
      static: { status: "STATIC", authority: "work_session_state", evidence_ref: "canonical-credential-pointer.test.ts", source_revision: "aa278a397f019e882eb28d2bcdf89444d9457022", observed_at: observed },
      hermetic: { status: "HERMETIC", authority: "work_session_state", evidence_ref: "runtime-adapter.test.ts", source_revision: "aa278a397f019e882eb28d2bcdf89444d9457022", observed_at: observed },
      live: { status: "LIVE", authority: "command_evidence", evidence_ref: "cmd_11d8a85d-aaa0-46d1-b9d9-481c4753812b", source_revision: "aa278a397f019e882eb28d2bcdf89444d9457022", observed_at: observed },
    },
    constraints: [
      "no Production OAuth",
      "no writes",
      "no second Google credential family",
      "do not mix client-config repair into PR #19",
    ],
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

  const ctx = getCurrentWorkContext();
  ok("fresh query finds the recorded work_id", ctx.work_id === workId);
  ok("branch/SHA from git not from the interpretation string", ctx.git.source_revision === sha && ctx.git.branch.length > 0);
  ok("current boundary is oauth-client-config-resolution", ctx.current_boundary?.id === "oauth-client-config-resolution");
  ok("next boundary is live-gmail-refresh", ctx.next_boundary?.id === "live-gmail-refresh");
  ok("relevant files are the recorded set only", ctx.relevant_files.length === 4 && ctx.relevant_files[0]!.includes("client-config-store.ts"));
  ok("capability ids resolve from the live registry", ctx.relevant_capabilities[0]?.capability_id === "google-workspace" && ctx.relevant_capabilities[0]?.authority === "capability_registry");
  ok("google-workspace capability presence is registry-backed", getCapability("google-workspace") !== undefined && ctx.relevant_capabilities[0]?.present === true);
  ok("open PRs are pointers not a PR database copy", ctx.open_prs.map((p) => p.number).join(",") === "16,17,18,19");
  ok("constraints recorded as structured do_not_repeat", ctx.constraints.includes("no Production OAuth"));
  ok("checkpoint SHA matches recorded source_revision", ctx.revision_awareness.checkpoint_revision === sha && ctx.revision_awareness.checkpoint_stale === false);
  ok("journal is isolated to test root", journalPath().startsWith(ROOT));

  const prior = currentCheckpoint(workId);
  ok("prior checkpoint exists", prior !== null);
  if (prior) {
    appendCheckpoint({
      ...prior,
      checkpoint_id: undefined,
      updated_at: undefined,
      source_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  }
  const stale = getCurrentWorkContext(workId);
  ok("HEAD change marks checkpoint stale", stale.revision_awareness.checkpoint_stale === true && stale.git.source_revision === sha);
  ok("interpretation is supplemental", stale.interpretation !== null && stale.current_boundary?.id !== stale.interpretation);

  const fact = getCurrentWorkContextFact(workId);
  ok("MCP fact carries work_context", Boolean((fact as { work_context?: { work_id?: string } }).work_context?.work_id === workId));
  ok("MCP fact has no credential material", containsCredentialMaterial(fact) === false);

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
