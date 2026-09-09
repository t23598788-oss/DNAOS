/**
 * Public ConnectorInvoker for Google Workspace — the only file
 * control/connector-execution-boundary/registry.ts may import from this folder.
 * Closes production credential/fetch deps at module load (or hermetic test override).
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { ConnectorBoundaryOutcome, ConnectorInvoker } from "../../control/connector-execution-boundary/types";
import { GOOGLE_WORKSPACE_OUTCOMES } from "./adapter-contract";
import { handleGoogleWorkspaceReadCommand, type GoogleWorkspaceAdapterDeps } from "./google-workspace-adapter";

let hermeticDeps: GoogleWorkspaceAdapterDeps | null = null;

/** Hermetic tests only — pass null to restore production deps. */
export function installGoogleWorkspaceAdapterDepsForTests(deps: GoogleWorkspaceAdapterDeps | null): void {
  hermeticDeps = deps;
}

export function isGoogleWorkspaceAdapterInvokerCallable(): boolean {
  return typeof invokeGoogleWorkspaceConnector === "function";
}

export const invokeGoogleWorkspaceConnector: ConnectorInvoker = async (
  command: CommandEnvelope,
): Promise<ConnectorBoundaryOutcome> => {
  const outcome = await handleGoogleWorkspaceReadCommand(command, hermeticDeps ?? {});

  if (outcome.ok) {
    const data = outcome.event.data;
    return {
      ok: true,
      auth_required: false,
      summary: `SUCCESS provider=${data.provider} service=${data.service} action=${data.action}`,
      evidence: outcome.evidence,
      artifacts: [
        { kind: "event_id", ref: outcome.event.event_id },
        { kind: "command_id", ref: data.command_id },
        { kind: "correlation_id", ref: data.correlation_id },
        { kind: "google_workspace_result", ref: JSON.stringify(data) },
      ],
    };
  }

  const code = outcome.rejection.outcome;
  const authRequired = code === GOOGLE_WORKSPACE_OUTCOMES.AUTH_REQUIRED;
  const artifacts: Array<{ kind: string; ref: string }> = [];
  if (outcome.rejection.clarification_candidates && outcome.rejection.clarification_candidates.length > 0) {
    artifacts.push({
      kind: "sheets_clarification_candidates",
      ref: JSON.stringify(outcome.rejection.clarification_candidates),
    });
  }
  return {
    ok: false,
    auth_required: authRequired,
    summary: `${code}: ${outcome.rejection.reason}`,
    evidence: outcome.evidence,
    artifacts,
  };
};
