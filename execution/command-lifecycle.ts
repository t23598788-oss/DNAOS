/**
 * Command Lifecycle — the states a CommandEnvelope moves through, and the
 * one legal order between them. Mirrors dna-os-deadboard's own
 * Connect->Register->Test->Enable->Run discipline (a real, "LOCKED"
 * pattern proven to work in that codebase) applied to this system's own
 * boundary instead of to a single connector row.
 *
 * NOT_YET_BUILT: this is the state machine's shape only. No executor
 * exists yet (see ../controller/README.md and ../connectors/README.md).
 */

export type CommandLifecycleStage =
  | "received" // arrived at the boundary, not yet touched
  | "authenticated" // issued_by identity verified real
  | "authorized" // isWithinOwnScope (or a valid break-glass grant) confirmed
  | "classified" // intent resolved to a real, known capability — unknown intent stops here, never guessed
  | "routed" // resolved to exactly one destination adapter, within the issuer's own tenant/account
  | "executing" // adapter call in flight
  | "evidenced" // a durable record written (see ../audit/) BEFORE the caller is told it succeeded
  | "responded" // result returned to the caller, through the same scope it arrived on
  | "rejected" // stopped at any stage above "received" — always carries a reason (see RoutingResult in ../contracts/envelope.ts)
  | "failed"; // executing started but the adapter call itself failed

/**
 * Legal forward transitions. No stage may be skipped — in particular,
 * "executing" -> "responded" is not legal; "evidenced" must happen first,
 * so a caller is never told an action succeeded before it has a durable
 * record (same principle as dna-os-deadboard's Rule 115 payment evidence
 * ordering, applied here to every command, not just money).
 */
export const LEGAL_TRANSITIONS: Record<CommandLifecycleStage, CommandLifecycleStage[]> = {
  received: ["authenticated", "rejected"],
  authenticated: ["authorized", "rejected"],
  authorized: ["classified", "rejected"],
  classified: ["routed", "rejected"],
  routed: ["executing", "rejected"],
  executing: ["evidenced", "failed"],
  evidenced: ["responded"],
  responded: [],
  rejected: [],
  failed: ["responded"], // a failure is still evidenced and responded to, never silently dropped
};

export interface CommandLifecycleState {
  command_id: string;
  stage: CommandLifecycleStage;
  history: Array<{ stage: CommandLifecycleStage; at: string; note?: string }>;
}
