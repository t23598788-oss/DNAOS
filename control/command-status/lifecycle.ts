/**
 * หน้าที่: track the states a CommandEnvelope moves through, and the one
 * legal order between them. Mirrors dna-os-deadboard's own
 * Connect->Register->Test->Enable->Run discipline applied to this
 * system's own command boundary.
 *
 * Moved 2026-08-14 from the old top-level `execution/` folder — that
 * folder's MEANING changed in this reorg: `../../execution/` (new) is
 * now specifically about actually running software (run/build/test/
 * deploy/rollback/code-change). Tracking a Command's own lifecycle state
 * belongs here, in control/, not there.
 *
 * Input: a CommandEnvelope (see ../../contracts/command/command-envelope.ts).
 * Output: `CommandLifecycleStage`, `LEGAL_TRANSITIONS`, `CommandLifecycleState`.
 * Dependency ที่อนุญาต: none directly (command_id is a plain string reference).
 * สิ่งที่ห้ามแตะ: never allow a transition that skips "evidenced" before
 * "responded" — a caller must never be told an action succeeded before a
 * durable audit record exists (see ../../audit/command-audit/).
 *
 * NOT_YET_BUILT: no executor exists yet — see ../command-router/README.md.
 */

export type CommandLifecycleStage =
  | "received" // arrived at the boundary, not yet touched
  | "authenticated" // issued_by identity verified real
  | "authorized" // scope-check (or a valid break-glass grant) confirmed
  | "classified" // intent resolved to a real, known capability — unknown intent stops here, never guessed
  | "routed" // resolved to exactly one destination adapter, within the issuer's own tenant/account
  | "executing" // adapter call in flight
  | "evidenced" // a durable record written BEFORE the caller is told it succeeded
  | "responded" // result returned to the caller, through the same scope it arrived on
  | "rejected" // stopped at any stage above "received" — always carries a reason
  | "failed"; // executing started but the adapter call itself failed

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
  failed: ["responded"],
};

export interface CommandLifecycleState {
  command_id: string;
  stage: CommandLifecycleStage;
  history: Array<{ stage: CommandLifecycleStage; at: string; note?: string }>;
}
