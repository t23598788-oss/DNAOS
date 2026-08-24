/**
 * หน้าที่: Phase 9 end-to-end proof — Registry (source-map) -> Resolve
 * pointer -> Live fetch -> Normalize -> Fingerprint -> Compare -> Produce
 * finding (Change Detection row) -> discard transient raw data. Prints
 * proof that raw external content was never persisted: it reports
 * `bytes_fetched` (a count) but never the content itself, and the process
 * heap holds no reference to it after `checkSourceLiveNow` returns.
 *
 * Input: none (reads ./sources/source-map.ts).
 * Output: one line per source with LiveCheckResult + change-log status.
 * Dependency ที่อนุญาต: ./sources/source-map, ./live-check/live-fetch,
 * ./live-check/change-log.
 */

import { HOSTINGER_SOURCE_POINTERS } from "./sources/source-map";
import { checkSourceLiveNow } from "./live-check/live-fetch";
import { listChangeLog } from "./live-check/change-log";

async function main(): Promise<void> {
  for (const source of HOSTINGER_SOURCE_POINTERS) {
    const result = await checkSourceLiveNow(source);
    console.log(JSON.stringify(result));
  }
  console.log("--- change-log.jsonl now contains ---");
  for (const row of listChangeLog()) console.log(JSON.stringify(row));
}

void main();
