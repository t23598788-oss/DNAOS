/**
 * sim/reset.ts — remove anything a run created.
 *
 * It deletes ONLY rows carrying this run's SIM marker; every other filter is
 * refused by sim/db.ts. On a run that was rejected at the door (the normal
 * case today) this deletes nothing.
 */
import { deleteSimRows, SIM_MARK } from "./db";
import { dbHost, loadEnv } from "./env";

loadEnv();

async function main(): Promise<void> {
  console.log(`target database: ${dbHost()}`);
  console.log(`marker: ${SIM_MARK}`);
  const results = await deleteSimRows();
  let total = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.table}: cannot delete (${r.error})`);
      continue;
    }
    total += r.deleted ?? 0;
    console.log(`  ${r.table}: deleted ${r.deleted}`);
  }
  console.log(`total deleted: ${total}`);
}

main().catch((err) => {
  console.error("reset failed:", err);
  process.exit(1);
});
