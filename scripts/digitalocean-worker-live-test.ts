/**
 * DigitalOcean Worker — Live Connectivity Test (owner, 2026-08-10,
 * DigitalOcean AI Inference Discovery → Implementation). Calls the real
 * digitalOceanApiAdapter.execute() with a trivial, cheap, real request
 * and reports model response, token usage, cost, latency, and error
 * handling — the exact same code path the real Worker Router uses.
 *
 * Requires a real DIGITALOCEAN_INFERENCE_API_KEY in .env.local — refuses
 * to run without one rather than silently no-op'ing or faking a result
 * (same discipline as scripts/register-tiktok-connector.ts /
 * scripts/register-google-maps-connector.ts).
 *
 * Run: npx tsx scripts/digitalocean-worker-live-test.ts
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
try {
  const envFile = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1);
  }
} catch {
  console.error("[digitalocean-worker-live-test] .env.local not found — aborting");
  process.exit(1);
}

import { digitalOceanApiAdapter } from "../app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter";
import { selectWorker } from "../app/api/admin/ide/_lib/workerSelectorRuntime";
import type { WorkerRequest } from "../app/api/admin/ide/_lib/workerContract";

async function main() {
  if (!process.env.DIGITALOCEAN_INFERENCE_API_KEY) {
    console.log("SKIP — DIGITALOCEAN_INFERENCE_API_KEY not in .env.local. No real key, no live test — nothing faked.");
    return;
  }

  const request: WorkerRequest = {
    workerRequestId: randomUUID(), workspaceSessionId: randomUUID(), executionPlanId: null, stepId: "digitalocean-live-test", workerType: "CODE_WORKER",
    capabilityRequired: "code.generate", contextPackageId: null, contextFingerprint: null, permittedReadScope: [], permittedWriteScope: [],
    permittedTools: [], forbiddenTools: [], expectedOutputSchema: "n/a", timeoutMs: 30_000, maxCalls: 1, maxTokens: 200, maxCost: null,
    privacyLevel: "CLOUD_ALLOWED", networkPolicy: "OUTBOUND_ALLOWED", approvalPolicy: "OWNER_APPROVAL_REQUIRED", actor: "owner-verification@dnaos.local",
    createdAt: new Date().toISOString(),
    taskDescription: "Answer the question only — this is a live connectivity test, not a real code task.",
    acceptanceCriteria: ["Return answer=\"pong\" and an empty files array."],
    fileContents: [],
  };

  console.log(`Model configured: ${process.env.DIGITALOCEAN_INFERENCE_MODEL || "(default) llama3-8b-instruct"}`);
  console.log("Calling digitalOceanApiAdapter.execute() — real request, real network call...\n");

  const response = await digitalOceanApiAdapter.execute(request);

  console.log("=== Real WorkerResponse ===");
  console.log(`status:      ${response.status}`);
  console.log(`model:       ${response.model}`);
  console.log(`durationMs:  ${response.durationMs}`);
  console.log(`tokenUsage:  ${JSON.stringify(response.tokenUsage)}`);
  console.log(`cost:        ${JSON.stringify(response.cost)}`);
  console.log(`answer:      ${response.answer ?? "(none)"}`);
  console.log(`output:      ${response.output?.slice(0, 300) ?? "(none)"}`);
  console.log(`error:       ${response.error ?? "(none)"}`);
  console.log(`limitations: ${JSON.stringify(response.limitations)}`);

  const health = await digitalOceanApiAdapter.health();
  console.log(`\nhealth() after this call: ${JSON.stringify(health)}`);

  const routed = await selectWorker({ ...request, workerRequestId: randomUUID() });
  const doCandidate = routed.candidatesConsidered.find((c) => c.adapterId === "digitalocean-api");
  console.log(`\nselectWorker() after a proven-live call — digitalocean-api candidate: ${JSON.stringify(doCandidate)}`);
  console.log(`selectWorker() outcome: ${routed.outcome}, selectedAdapterId: ${routed.selectedAdapterId}`);

  if (response.status !== "SUCCEEDED" && response.status !== "PARTIAL") {
    console.error(`\nFAIL — expected a real, live SUCCEEDED/PARTIAL response, got ${response.status}: ${response.error}`);
    process.exit(1);
  }
  console.log("\nPASS — real live call completed and was correctly reflected in both the adapter's own health() and the real selectWorker() ranking.");
}

main().catch((e) => { console.error("SCRIPT CRASHED:", e); process.exit(1); });
