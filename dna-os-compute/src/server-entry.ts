/**
 * dna-os-compute CLI server entry (Phase 2, 2026-10-16).
 *
 * Bootstrap is ENV-DRIVEN ONLY (no config file, no business plane):
 *   DNA_COMPUTE_PORT          default 0 = OS-assigned (prints the real port)
 *   DNA_COMPUTE_BIND_HOST     default 127.0.0.1 (loopback-safe default)
 *   DNA_COMPUTE_TOKEN         daemon bearer token (required for /commands)
 *   DNA_COMPUTE_INFER_ENDPOINT  optional; without it ai.infer stays honest
 *                             NOT_CONFIGURED (fail-closed)
 *   DNA_COMPUTE_DEVICE_ID     optional registration id (relay phase)
 *
 * Prints one machine-readable line on ready:
 *   DNA_COMPUTE_READY port=<port> capabilities=<aiInfer|codeRead|...>
 * The relay acceptance test spawns this file and waits for that line — so
 * the REAL daemon (not a mock server) is exercised end-to-end.
 */
import { daemonFromEnv } from "./daemon.js";
import { gpuAdapterFor } from "./metering.js";

async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    console.log("dna-os-compute@0.1.0");
    process.exit(0);
  }
  const daemon = daemonFromEnv({}, gpuAdapterFor());
  const server = await daemon.start();
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : Number(process.env.DNA_COMPUTE_PORT ?? 0);
  const hb = daemon.heartbeat();
  console.log(`DNA_COMPUTE_READY port=${port} aiInfer=${hb.capabilities.aiInfer} codeRead=${hb.capabilities.codeRead} buildRun=${hb.capabilities.buildRun} testRun=${hb.capabilities.testRun}`);
}

main().catch((error: unknown) => {
  console.error(`DNA_COMPUTE_BOOT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
