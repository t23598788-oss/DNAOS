/**
 * หน้าที่: the real, runnable entrypoint — builds a CircuitState,
 * initializes it from real repo signals via
 * ../adapter/internal-state-adapter.ts, starts the SSE/static server,
 * and (only when RUN_LIVE_DEMO=1 is set) drives one real command through
 * the real permission/execution modules a few seconds after boot, so a
 * headless browser can capture an idle screenshot and then a mid-flight
 * one. Not imported by anything else — this is the process entrypoint,
 * run via `npx tsx dna-os-circuit/runtime/start.ts`.
 *
 * Dependency ที่อนุญาต: ./circuit-state.ts, ./server.ts,
 * ../adapter/internal-state-adapter.ts, ./host-runtime.ts.
 */

import { CircuitState } from "./circuit-state";
import { startCircuitServer } from "./server";
import { initializeCircuitFromRepo, driveRealPermissionAndExecutionDemo } from "../adapter/internal-state-adapter";
import { readEnvVar } from "./host-runtime";

declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

async function main(): Promise<void> {
  const state = new CircuitState();
  await initializeCircuitFromRepo(state);

  const port = Number(readEnvVar("CIRCUIT_PORT") ?? "8790");
  startCircuitServer(state, port);
  console.log(`[dna-os-circuit] server listening on http://localhost:${port}`);

  if (readEnvVar("RUN_LIVE_DEMO") === "1") {
    const delayMs = Number(readEnvVar("LIVE_DEMO_DELAY_MS") ?? "1500");
    setTimeout(() => {
      console.log("[dna-os-circuit] driving real permission+execution demo...");
      driveRealPermissionAndExecutionDemo(state).catch((error) => {
        console.error("[dna-os-circuit] demo run failed:", error instanceof Error ? error.message : String(error));
      });
    }, delayMs);
  }
}

main().catch((error) => {
  console.error("[dna-os-circuit] fatal startup error:", error instanceof Error ? error.message : String(error));
});
