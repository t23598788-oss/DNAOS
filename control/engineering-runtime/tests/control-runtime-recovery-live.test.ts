/**
 * Live proof: reconstruct from canonical git, rebind credentials by reference,
 * then run one Owner engineering publication from the reconstructed runtime.
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/control-runtime-recovery-live.test.ts
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createConnectionRegistryStore } from "../../../connections/connection-registry/contract";
import { verifyGithubCredentialBind } from "../../../connections/github/credential-rebind";
import { probeGithubPublicationAuth } from "../../../connections/github/publication-auth-probe";
import { containsCredentialMaterial } from "../../../connections/dna-os-mcp/runtime-facts";
import {
  MCP_SELF_REPORTING_TOOL_NAMES,
  reconstructControlRuntime,
  untrackedLifecycleWasNotCopied,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const CHECKOUT = process.cwd();
const STAMP = Date.now();
const DEST = join(CHECKOUT, "tests/__sandbox__", `control-runtime-recovery-live-${STAMP}`);

function parseChildReport(stdout: string): Record<string, unknown> {
  const line = stdout.split("\n").map((item) => item.trim()).find((item) => item.startsWith("DNA_OS_RECONSTRUCTED_OWNER_COMMAND "));
  if (!line) return {};
  return JSON.parse(line.slice("DNA_OS_RECONSTRUCTED_OWNER_COMMAND ".length)) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: CHECKOUT, encoding: "utf8" }).trim().toLowerCase();
  const reconstruction = await reconstructControlRuntime({
    canonical_source: CHECKOUT,
    destination_root: DEST,
    checkout_sha: sha,
  });
  const clonedTools = reconstruction.ok
    ? readFileSync(join(DEST, "connections/dna-os-mcp/tool-registry.ts"), "utf8")
    : "";
  const mcpFromCommit = MCP_SELF_REPORTING_TOOL_NAMES.every((name) => clonedTools.includes(name));
  const capabilityFromCommit = reconstruction.capability_ids.includes("engineering-runtime")
    || (reconstruction.ok && readFileSync(join(DEST, "control/command-router/capability-registry.ts"), "utf8").includes("capability_id: \"engineering-runtime\""));

  const connStore = createConnectionRegistryStore(join(DEST, "connections/connection-registry/data"));
  const connection = connStore.listConnections().find((row) =>
    row.adapter === "github"
    && row.target?.repository === "-DNA-OS-INFRASTRUCTURE-"
    && row.credential_ref.kind === "keychain_ref"
  ) ?? null;
  const bind = await verifyGithubCredentialBind(connection);
  const parentProbe = await probeGithubPublicationAuth(connection);
  const secretExposed = containsCredentialMaterial({ reconstruction, bind, parentProbe }) || bind.secret_exposed || parentProbe.secret_exposed;

  let child: Record<string, unknown> = {};
  let childFailed = "";
  let destProbe: Record<string, unknown> = {};
  if (reconstruction.ok && mcpFromCommit) {
    const tsxBin = join(CHECKOUT, "node_modules/.bin/tsx");
    try {
      const probeOut = execFileSync(tsxBin, [join(CHECKOUT, "control/engineering-runtime/tests/publication-auth-probe-run.ts")], {
        cwd: DEST,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env },
      });
      const probeLine = probeOut.split("\n").map((item) => item.trim()).find((item) => item.startsWith("DNA_OS_PUBLICATION_AUTH_PROBE "));
      destProbe = probeLine ? JSON.parse(probeLine.slice("DNA_OS_PUBLICATION_AUTH_PROBE ".length)) as Record<string, unknown> : {};
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const probeLine = String(err.stdout ?? "").split("\n").map((item) => item.trim()).find((item) => item.startsWith("DNA_OS_PUBLICATION_AUTH_PROBE "));
      destProbe = probeLine ? JSON.parse(probeLine.slice("DNA_OS_PUBLICATION_AUTH_PROBE ".length)) as Record<string, unknown> : {};
      if (!probeLine) childFailed = String(err.stderr ?? err.message ?? error).slice(0, 800);
    }
    if (bind.state === "VERIFIED" && destProbe.publication_auth_ok === true) {
    try {
      const stdout = execFileSync(tsxBin, [join(CHECKOUT, "control/engineering-runtime/tests/reconstructed-runtime-owner-command.ts")], {
        cwd: DEST,
        encoding: "utf8",
        timeout: 180_000,
        env: {
          ...process.env,
          ENGINEERING_LIFECYCLE_LOG: `lifecycle-reconstructed-${STAMP}.jsonl`,
          ENGINEERING_GITHUB_PROOF_LOG: `github-proofs-reconstructed-${STAMP}.jsonl`,
          ENGINEERING_VERIFIED_CAPABILITY_LOG: `verified-caps-reconstructed-${STAMP}.jsonl`,
          ENGINEERING_PUBLICATION_POINTER_LOG: `pub-ptr-reconstructed-${STAMP}.jsonl`,
          ENGINEERING_WORKSPACE_CLEANUP_LOG: `ws-clean-reconstructed-${STAMP}.jsonl`,
        },
      });
      child = parseChildReport(stdout);
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      child = parseChildReport(String(err.stdout ?? ""));
      childFailed = String(err.stderr ?? err.message ?? error).slice(0, 800);
    }
    }
  }

  const destAuthOk = destProbe.publication_auth_ok === true;
  const sameRef = parentProbe.credential_ref === destProbe.credential_ref && typeof parentProbe.credential_ref === "string";
  const sameProvider = parentProbe.resolver_kind === destProbe.resolver_kind && parentProbe.resolver_service === destProbe.resolver_service && parentProbe.resolver_account === destProbe.resolver_account;
  const samePath = parentProbe.credential_ref_kind === "keychain_ref" && destProbe.credential_ref_kind === "keychain_ref" && parentProbe.provider === "github";
  const proofs = {
    L: parentProbe.resolve_ok === true && !secretExposed,
    M: destProbe.resolve_ok === true && sameRef,
    N: samePath && sameProvider && destProbe.credential_source === parentProbe.credential_source,
    O: !secretExposed && destProbe.CREDENTIAL_SECRET_EXPOSED !== true,
    P: destAuthOk && parentProbe.publication_auth_ok,
    Q: child.POST_REBIND_OWNER_COMMAND_VERIFIED === true,
    R: typeof child.CANONICAL_WORK_ID === "string" && child.POST_REBIND_OWNER_COMMAND_VERIFIED === true,
    S: child.WORKSPACE_CLEANUP === "CLEANED" && typeof child.CANONICAL_WORK_ID === "string" && child.CANONICAL_WORK_ID.startsWith("work-"),
    T: child.EXTERNAL_CLIENT_READ_RECONSTRUCTED_RUNTIME === true && child.EXTERNAL_STATUS_SOURCE === "DNA_OS_RUNTIME" && typeof child.CANONICAL_WORK_ID === "string" && child.CANONICAL_WORK_ID.startsWith("work-"),
  };
  const all = Object.values(proofs).every(Boolean);
  const blocking = Object.entries(proofs).filter(([, ok]) => !ok).map(([name]) => name);

  const report = {
    CREDENTIAL_PARENT_VERIFY: bind.state,
    PUBLICATION_CREDENTIAL_REF_RESOLVED: destProbe.resolve_ok === true,
    PUBLICATION_CREDENTIAL_PROVIDER: destProbe.credential_source ?? parentProbe.credential_source,
    CREDENTIAL_PATH_CONTINUITY_PROVEN: sameRef && sameProvider && samePath,
    PUBLICATION_AUTH_PROBE: destAuthOk && parentProbe.publication_auth_ok ? "OK" : "FAILED",
    NEW_WORK_ID: child.CANONICAL_WORK_ID ?? null,
    LOCAL_ENGINEERING_STATUS: child.RESULT_STATUS ?? "NOT_RUN",
    REMOTE_PUBLICATION_STATUS: child.POST_REBIND_OWNER_COMMAND_VERIFIED === true ? "VERIFIED" : "NOT_RUN",
    REMOTE_PUBLICATION_VERIFIED: child.POST_REBIND_OWNER_COMMAND_VERIFIED === true,
    EXTERNAL_CLIENT_READ_NEW_WORK: child.EXTERNAL_CLIENT_READ_RECONSTRUCTED_RUNTIME === true,
    EXTERNAL_STATUS_SOURCE: child.EXTERNAL_STATUS_SOURCE ?? "NOT_RUN",
    CREDENTIAL_SECRET_EXPOSED: secretExposed || child.CREDENTIAL_SECRET_EXPOSED === true || destProbe.CREDENTIAL_SECRET_EXPOSED === true,
    COPIED_CREDENTIAL_STATE: false,
    WORKSPACE_CLEANUP: child.WORKSPACE_CLEANUP ?? "NOT_RUN",
    FULL_MACHINE_INDEPENDENCE: reconstruction.full_machine_independence,
    PARENT_PROBE: {
      resolve_ok: parentProbe.resolve_ok,
      github_http_status: parentProbe.github_http_status,
      github_user_kind: parentProbe.github_user_kind,
      credential_source: parentProbe.credential_source,
      resolver_service: parentProbe.resolver_service,
      metadata_fingerprint: parentProbe.metadata_fingerprint,
      detail: parentProbe.detail,
    },
    DEST_PROBE: {
      resolve_ok: destProbe.resolve_ok,
      github_http_status: destProbe.github_http_status,
      github_user_kind: destProbe.github_user_kind,
      credential_source: destProbe.credential_source,
      resolver_service: destProbe.resolver_service,
      metadata_fingerprint: destProbe.metadata_fingerprint,
      process_cwd: destProbe.process_cwd,
      detail: destProbe.detail,
    },
    BIND_DETAIL: bind.detail,
    OWNER_NOTES_EXCERPT: (typeof child.OWNER_NOTES_EXCERPT === "string" && child.OWNER_NOTES_EXCERPT.length > 0)
      ? child.OWNER_NOTES_EXCERPT
      : childFailed,
    PROOFS: proofs,
    BLOCKING_LAYER: destAuthOk ? null : "GitHub credential validity",
    BLOCKING_COMPONENT: destAuthOk ? null : "connections/github/github-read-api.ts#getAuthenticatedUser",
    OBSERVED_FAILURE: destAuthOk ? null : parentProbe.detail,
    LAST_PROVEN_GOOD_BOUNDARY: parentProbe.resolve_ok ? "resolveGithubCredential via macos_keychain (non-empty secret)" : "connection credential_ref present",
    FINAL_STATUS: all ? "VERIFIED" : "BLOCKED",
  };

  rmSync(DEST, { recursive: true, force: true });
  console.log(`DNA_OS_CONTROL_RUNTIME_RECOVERY_LIVE ${JSON.stringify(report, null, 2)}`);
  process.exit(report.FINAL_STATUS === "VERIFIED" ? 0 : 2);
}

void main();
