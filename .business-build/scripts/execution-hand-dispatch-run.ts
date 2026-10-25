/**
 * EXECUTION_HAND Job Dispatcher — disposable, one-off invocation script
 * (session-scoped, not a permanent CLI entry point) that runs real Job
 * Contract JSON files already placed in workers/execution-hand/INBOX/
 * through the real RECEIVE->EXECUTE->RETURN-EVIDENCE->STANDBY cycle
 * (runExecutionHandJobFromInbox(), app/api/admin/ide/_lib/executionHandRuntime.ts).
 * Checked first (Rule 101): no existing CLI entry point calls
 * runExecutionHandJobFromInbox()/executeJobContract() outside
 * scripts/execution-hand-test.ts's acceptance suite (which resets its own
 * sandbox and is not meant to run a real, non-test Job Contract) — this
 * script fills that real, narrow gap, modeled closely on how
 * execution-hand-test.ts already invokes the same real functions.
 *
 * Usage: npx tsx scripts/execution-hand-dispatch-run.ts <inboxFileName> [...]
 */
import { runExecutionHandJobFromInbox } from "../app/api/admin/ide/_lib/executionHandRuntime";

const OWNER_ID = "owner-execution-hand-dispatch-2026-08-09";
const ACTOR = "execution-hand-dispatch-run@dnaos.local";

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: npx tsx scripts/execution-hand-dispatch-run.ts <inboxFileName> [...]");
    process.exit(1);
  }
  for (const f of files) {
    console.log(`\n================ Running INBOX/${f} ================`);
    const result = await runExecutionHandJobFromInbox(f, { ownerId: OWNER_ID, actor: ACTOR });
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((e) => {
  console.error("DISPATCH CRASHED:", e);
  process.exit(1);
});
