/**
 * Live proof: reconstruct from canonical git, rebind credentials by reference,
 * then run one Owner engineering publication from the reconstructed runtime.
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/control-runtime-recovery-live.test.ts
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createConnectionRegistryStore } from "../../../connections/connection-registry/contract";
import { verifyGithubCredentialBind } from "../../../connections/github/credential-rebind";
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
  const secretExposed = containsCredentialMaterial({ reconstruction, bind }) || bind.secret_exposed;

  let child: Record<string, unknown> = {};
  let childFailed = "";
  if (reconstruction.ok && mcpFromCommit && bind.state === "VERIFIED") {
    const nodeModules = join(DEST, "node_modules");
    if (!existsSync(nodeModules) && existsSync(join(CHECKOUT, "node_modules"))) {
      symlinkSync(join(CHECKOUT, "node_modules"), nodeModules);
    }
    execFileSync("npm", ["run", "conversation-runtime:build"], {
      cwd: DEST,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env },
    });
    try {
      const stdout = execFileSync("npx", ["tsx", "control/engineering-runtime/tests/reconstructed-runtime-owner-command.ts"], {
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

  const proofs = {
    A: mcpFromCommit && reconstruction.source_commit_sha === sha,
    B: reconstruction.ok && mcpFromCommit,
    C: capabilityFromCommit,
    D: reconstruction.copied_opaque_local_state === false && untrackedLifecycleWasNotCopied(CHECKOUT, DEST),
    E: !existsSync(join(DEST, ".env")) && !secretExposed,
    F: reconstruction.workspace_registration_recoverable,
    G: reconstruction.credential_bind_state === "UNBOUND" || reconstruction.credential_bind_state === "REBIND_REQUIRED",
    H: bind.state === "VERIFIED" && !secretExposed,
    I: child.POST_REBIND_OWNER_COMMAND_VERIFIED === true,
    J: child.WORKSPACE_CLEANUP === "CLEANED" && typeof child.CANONICAL_WORK_ID === "string" && child.CANONICAL_WORK_ID.startsWith("work-"),
    K: child.EXTERNAL_CLIENT_READ_RECONSTRUCTED_RUNTIME === true && child.EXTERNAL_STATUS_SOURCE === "DNA_OS_RUNTIME" && typeof child.CANONICAL_WORK_ID === "string" && child.CANONICAL_WORK_ID.startsWith("work-"),
  };
  const all = Object.values(proofs).every(Boolean);
  const blocking = Object.entries(proofs).filter(([, ok]) => !ok).map(([name]) => name);

  const report = {
    CONTROL_RUNTIME_RECONSTRUCTED_FROM_CANONICAL_GIT: reconstruction.ok,
    MCP_SELF_REPORTING_RECOVERED_FROM_COMMITTED_SOURCE: mcpFromCommit,
    CANONICAL_SELF_REPORTING_COMMIT: reconstruction.source_commit_sha,
    CREDENTIAL_REBIND_REQUIRED: reconstruction.credential_rebind_required,
    CREDENTIAL_REBIND_COMPLETED: bind.state === "VERIFIED",
    POST_REBIND_OWNER_COMMAND_VERIFIED: child.POST_REBIND_OWNER_COMMAND_VERIFIED === true,
    EXTERNAL_CLIENT_READ_RECONSTRUCTED_RUNTIME: child.EXTERNAL_CLIENT_READ_RECONSTRUCTED_RUNTIME === true,
    EXTERNAL_STATUS_SOURCE: child.EXTERNAL_STATUS_SOURCE ?? "NOT_RUN",
    COPIED_OPAQUE_LOCAL_STATE: reconstruction.copied_opaque_local_state,
    CREDENTIAL_SECRET_EXPOSED: secretExposed || child.CREDENTIAL_SECRET_EXPOSED === true,
    UNMANAGED_FILES_DELETED: false,
    WORKSPACE_CLEANUP: child.WORKSPACE_CLEANUP ?? "NOT_RUN",
    FULL_MACHINE_INDEPENDENCE: reconstruction.full_machine_independence,
    RECOVERABLE_CANONICAL_STATE: reconstruction.recoverable_canonical_state,
    REBINDABLE_STATE: reconstruction.rebindable_state,
    INTENTIONALLY_MACHINE_LOCAL_STATE: reconstruction.machine_local_not_transferred,
    CREDENTIAL_BIND_STATE_AFTER_CLONE: reconstruction.credential_bind_state,
    CREDENTIAL_BIND_STATE_AFTER_REBIND: bind.state,
    OWNER_NOTES_EXCERPT: (typeof child.OWNER_NOTES_EXCERPT === "string" && child.OWNER_NOTES_EXCERPT.length > 0)
      ? child.OWNER_NOTES_EXCERPT
      : childFailed,
    PROOFS: proofs,
    BLOCKING_DEPENDENCY: blocking.length === 0 ? null : blocking.join(","),
    FINAL_STATUS: all ? "VERIFIED" : "BLOCKED",
  };

  rmSync(DEST, { recursive: true, force: true });
  console.log(`DNA_OS_CONTROL_RUNTIME_RECOVERY_LIVE ${JSON.stringify(report, null, 2)}`);
  process.exit(report.FINAL_STATUS === "VERIFIED" ? 0 : 2);
}

void main();
