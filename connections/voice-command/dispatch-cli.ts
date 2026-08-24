/**
 * หน้าที่: the ONE thin CLI bridge `./app-host/`'s real macOS App Host
 * spawns per final transcript — calls the EXISTING, VERIFIED
 * `./dispatcher.ts`'s `handleTranscript()` directly, unchanged. No
 * intent resolution, no state machine, no Work Order construction of
 * its own — every real decision still belongs to `./dispatcher.ts`.
 *
 * Input: `process.argv[2]` — the real transcribed text.
 * Output: prints the real `HandleTranscriptResult` as JSON to stdout.
 * Dependency ที่อนุญาต: ./dispatcher.ts.
 */
import { handleTranscript } from "./dispatcher";

async function main(): Promise<void> {
  const text = process.argv[2];
  if (!text || text.trim().length === 0) {
    console.error("NO_TRANSCRIPT_ARGUMENT");
    process.exitCode = 1;
    return;
  }
  const result = await handleTranscript(text);
  console.log(JSON.stringify(result));
}

main();
