// RunPod Cloud GPU Controller (owner, 2026-08-04): "สร้างระบบดีเอ็นเอให้
// ตอบสนองกันกับเซิร์ฟเวอร์หลัก...โดยที่เฮียไม่ต้องกดเข้าไปดู" — the plumbing
// half of the Smart Dynamic Trigger the owner described earlier this same
// session (spin the Cloud GPU up only when there's real work, sleep it
// automatically otherwise, instead of paying for 24/7 uptime). This file is
// the one place DNA OS talks to RunPod directly — ensurePodRunning()/
// stopPod()/getPodStatus() — so nothing else in the codebase needs its own
// copy of GPU-fallback logic or RunPod's REST API shape.
//
// Same manual .env.local read pattern as ai-task-watcher.mjs (no dotenv
// dependency in this project). Needs RUNPOD_API_KEY set there — real key
// obtained 2026-08-04 (rpa_... prefix, via console.runpod.io/user/settings
// "API keys"; a distinct AWS_ACCESS_KEY_ID-shaped "S3 API key" and a
// user_-prefixed passkey ID were both mistaken for this at first — neither
// authenticates against the real API). Verified live: GET /v2/pods and
// creating a CPU pod both succeeded with this key — the account itself is
// NOT blocked. Every GPU pod create attempt (7 tries, 5 GPU types, both
// cloud types, 3 datacenters) failed with "no longer any instances
// available" while the CPU test succeeded instantly, pointing at a
// GPU-specific account tier/approval gate on RunPod's side rather than
// real stock exhaustion or a broken key — see chat 2026-08-04.
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const PROJECT_DIR = "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard";
const POD_NAME = "dna-os-ollama";
const IMAGE = "runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404"; // RunPod's own recommended default — newest CUDA/PyTorch, works across current GPU generations
const CONTAINER_DISK_GB = 30;
const PORTS = ["11434/http", "22/tcp"];

// Ordered cheapest-first, real prices/VRAM confirmed live via list-gpu-types
// 2026-08-04 — every model this project runs (qwen2.5vl:7b, thawatchai,
// qwen3:8b) fits comfortably in 24GB, so the fallback chain only exists to
// route around RunPod's own real-time stock churn, not a capability need.
const GPU_FALLBACK_CHAIN = [
  "NVIDIA GeForce RTX 3090",
  "NVIDIA GeForce RTX 4090",
  "NVIDIA RTX A6000",
  "NVIDIA A40",
  "NVIDIA GeForce RTX 5090",
];

function loadEnv() {
  return Object.fromEntries(
    readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
      .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
  );
}

async function runpodRequest(apiKey, path, options = {}) {
  const res = await fetch(`https://api.runpod.io/v2${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RunPod API ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function listPods(apiKey) {
  const data = await runpodRequest(apiKey, "/pods");
  // Real bug found live 2026-08-04: assumed {items: [...]} (the shape most
  // other RunPod list endpoints use); GET /v2/pods actually returns
  // {pods: [...]} — caught by directly curling the endpoint with the real
  // key rather than trusting the assumption.
  return (data.pods ?? []).filter((p) => p.name === POD_NAME);
}

// Real gap found live 2026-08-04: RunPod's own "availability" summary per
// GPU type does not reliably predict whether create-pod will actually
// succeed at that instant (spot capacity race, not a stale-cache issue —
// confirmed by 5 different GPU types all failing back-to-back). Trying each
// GPU in the fallback chain for real, not just trusting the catalog's
// advertised availability field, is the only honest way to find real stock.
//
// Real request shape verified live against GET https://api.runpod.io/v2/
// openapi.json 2026-08-04 (the MCP tool's own parameter names — imageName/
// gpuTypeIds/cloudType/containerDiskInGb — are its own abstraction, not the
// real wire format): POST /v2/pods wants {name, image, disk, ports,
// gpu:{id,count}, cloud}. A first attempt using the MCP-shaped names got a
// real 422 "missing property 'image'" — caught and fixed against the real
// schema, not guessed a second time.
async function tryCreatePod(apiKey, gpuTypeId) {
  return runpodRequest(apiKey, "/pods", {
    method: "POST",
    body: JSON.stringify({
      name: POD_NAME,
      image: IMAGE,
      disk: CONTAINER_DISK_GB,
      ports: PORTS,
      gpu: { id: gpuTypeId, count: 1 },
      cloud: "COMMUNITY",
    }),
  });
}

export async function ensurePodRunning() {
  const env = loadEnv();
  const apiKey = env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY ไม่ได้ตั้งค่าใน .env.local");

  // Real PodStatus enum verified against the OpenAPI spec: PROVISIONING/
  // STARTING/RUNNING/EXITED/ERROR/TERMINATED — a single `status` field, not
  // the desiredStatus/status pair an earlier draft assumed.
  const existing = await listPods(apiKey);
  const running = existing.find((p) => p.status === "RUNNING" || p.status === "PROVISIONING" || p.status === "STARTING");
  if (running) return { ok: true, action: "already_running", pod: running };

  const stopped = existing.find((p) => p.status === "EXITED");
  if (stopped) {
    // Real action endpoint verified against the spec: POST /pods/{id}/action
    // with body {action: "start"}, not a /pods/{id}/start path.
    const started = await runpodRequest(apiKey, `/pods/${stopped.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "start" }),
    });
    return { ok: true, action: "started_existing", pod: started };
  }

  const errors = [];
  for (const gpuTypeId of GPU_FALLBACK_CHAIN) {
    try {
      const pod = await tryCreatePod(apiKey, gpuTypeId);
      return { ok: true, action: "created", gpuTypeId, pod };
    } catch (e) {
      errors.push(`${gpuTypeId}: ${e.message}`);
    }
  }
  return { ok: false, action: "no_capacity", errors };
}

export async function stopPod() {
  const env = loadEnv();
  const apiKey = env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY ไม่ได้ตั้งค่าใน .env.local");

  const existing = await listPods(apiKey);
  if (!existing.length) return { ok: true, action: "no_pod" };
  const results = [];
  for (const pod of existing) {
    const stopped = await runpodRequest(apiKey, `/pods/${pod.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "stop" }),
    });
    results.push(stopped);
  }
  return { ok: true, action: "stopped", pods: results };
}

export async function getPodStatus() {
  const env = loadEnv();
  const apiKey = env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY ไม่ได้ตั้งค่าใน .env.local");
  const existing = await listPods(apiKey);
  return { ok: true, pods: existing };
}

// CLI entry point — `node runpod-controller.mjs ensure|stop|status`.
// This is the manual/testable path; wiring ensurePodRunning()/stopPod()
// into ai-task-watcher.mjs's own poll loop (real Smart Dynamic Trigger:
// wake on a real queued ai_tasks row, sleep after N minutes idle) is the
// next real step once a GPU pod create has been confirmed to succeed at
// least once (currently blocked on a GPU-specific RunPod account gate —
// CPU pod creation already verified working with the real key).
//
// Real bug found live 2026-08-04: `import.meta.url === 'file://' +
// process.argv[1]` silently never matched on this project's real path
// (contains a space and Thai characters — file:// URLs percent-encode
// those, argv[1] doesn't), so the CLI block never ran and the script
// exited 0 with zero output, zero error. fileURLToPath() decodes the URL
// back to a real filesystem path first so the comparison is apples-to-apples.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  const fn = { ensure: ensurePodRunning, stop: stopPod, status: getPodStatus }[cmd];
  if (!fn) {
    console.error("ใช้งาน: node runpod-controller.mjs ensure|stop|status");
    process.exit(1);
  }
  fn().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
}
